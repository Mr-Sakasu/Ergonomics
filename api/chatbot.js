// api/chatbot.js  (REPLACE WHOLE FILE)
//
// Returns:
// - keyword_zh: the actual Chinese query for JD search (zh-CN)
// - display_query: keyword-style query in user's language (NOT a sentence)
// - queries: [{q, lang}, ...]
//
// Hard requirements:
// - DO NOT invent constraints (esp numeric budget limits).
// - If the user didn't explicitly mention a numeric budget, do not add any.
// - display_query should look like a search bar query: short keywords separated by spaces.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 12000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), ms);
    try { return await fetch(url, { ...opt, signal: ctrl.signal }); }
    finally { clearTimeout(id); }
}

function splitUserAndContext(raw = "") {
    const s = String(raw || "");
    const marker = "[PageContext]";
    const idx = s.indexOf(marker);
    if (idx === -1) return { userText: s.trim(), pageContext: "" };
    return { userText: s.slice(0, idx).trim(), pageContext: s.slice(idx).trim() };
}

function normalizeLangHint(langHint = "") {
    const s = String(langHint || "").trim();
    if (!s) return "";
    return s.replace("_", "-");
}
function langBase(lang = "") {
    const s = String(lang || "").toLowerCase();
    return s.split("-")[0] || "en";
}
function detectLangHeuristic(text = "") {
    const s = String(text);
    if (/[ぁ-んァ-ン]/.test(s)) return "ja";
    if (/[\uac00-\ud7af]/.test(s)) return "ko";
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(s)) return "zh";
    return "en";
}
function toBcp47(base = "en") {
    const b = String(base).toLowerCase();
    if (b.startsWith("ja")) return "ja-JP";
    if (b.startsWith("zh")) return "zh-CN";
    if (b.startsWith("ko")) return "ko-KR";
    return "en-US";
}

function getUiStrings(langCode = "en-US") {
    const b = langBase(langCode);
    if (b === "ja") return { refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。" };
    if (b === "zh") return { refine: "说下预算/品牌/用途，我可以再筛选。" };
    return { refine: "Tell me budget/brand/use case to refine." };
}

function sanitizeHost(host = "") {
    const s = String(host || "").trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(s)) return "";
    return s;
}
function isJdHost(host = "") {
    const h = (host || "").toLowerCase();
    return h === "jd.com" || h.endsWith(".jd.com");
}
function looksLikeJDQuery(text = "") {
    const s = String(text || "");
    return /(^|\b)jd(\b|$)|京东|京東|jingdong/i.test(s);
}

function normalizeSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}
function normalizeForCompare(s) {
    return String(s || "")
        .replace(/[。\.\,，、！!？\?「」『』（）\(\)\[\]【】]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Determine if user explicitly gave numeric budget / price limit.
 * Examples:
 * - "10万円", "10000円以下", "under $200", "5000元以内"
 */
function hasExplicitNumericBudget(userText = "") {
    const s = String(userText || "");

    const hasDigit = /\d/.test(s);
    const hasCurrency = /(円|¥|jpy|yen|元|块|rmb|cny|￥|\$|usd|eur|€|£|gbp|人民币|日元|万円)/i.test(s);
    const hasLimitWord = /(以下|以内|未満|まで|上限|under|below|less\s+than|up\s+to|<=|<)/i.test(s);

    // CJK numerals + currency (covers "一万円", "五千元" etc)
    const hasCjkNum = /[〇零一二三四五六七八九十百千万億两壹贰叁肆伍陆柒捌玖拾佰仟]/.test(s);

    return (hasDigit && (hasCurrency || hasLimitWord)) || (hasCjkNum && hasCurrency);
}

/**
 * Remove budget-like fragments from queries (ONLY used when user didn't give budget explicitly).
 * Important: do not remove model numbers like "iPhone 15" (no currency words -> safe).
 */
function stripBudgetConstraints(q = "") {
    let s = String(q || "");

    // English-like: "under 200", "below $300"
    s = s.replace(/(?:under|below|less\s+than|up\s+to)\s*\$?\s*\d+(?:\.\d+)?\s*(?:usd|dollars|cny|rmb|jpy|yen|円|元|块|人民币)?/gi, " ");

    // Currencies: "10万円", "5000元以下", "$200", "3000 CNY"
    s = s.replace(/\d+(?:\.\d+)?\s*(?:万円|円|¥|￥|元|块|人民币|日元|jpy|yen|cny|rmb|usd|\$|eur|€|gbp|£)\s*(?:以下|以内|未満|まで|上限)?/gi, " ");

    // "2000以下" style
    s = s.replace(/\d+(?:\.\d+)?\s*(?:以下|以内|未満)/gi, " ");

    // Cleanup punctuation/spaces
    s = s.replace(/[，,。．・/／|｜]+/g, " ");
    return normalizeSpaces(s);
}

function looksTooSentenceLike(displayQuery = "", userLang = "en-US") {
    const s = String(displayQuery || "");
    if (!s) return true;

    // contains typical sentence punctuation
    if (/[。！？\?!.]/.test(s)) return true;

    const b = langBase(userLang);
    if (b === "ja") {
        // polite endings etc
        if (/(です|ます|ください|お願い|欲しい|ほしい|探して|教えて|おすすめ)/.test(s)) return true;
    }
    if (b === "en") {
        if (/\b(i want|i'm looking for|can you|please|recommend)\b/i.test(s)) return true;
    }
    return false;
}

/**
 * Fallback: make a "search bar keywords" string when LLM output is too sentence-like.
 * (Mainly for Japanese.)
 */
function fallbackDisplayQuery(userText = "", userLang = "en-US") {
    let s = String(userText || "");

    // general punctuation -> spaces
    s = s.replace(/[。\n\r\t]/g, " ");
    s = s.replace(/[、，,。．・/／|｜]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();

    const b = langBase(userLang);
    if (b === "ja") {
        // remove typical filler / polite words
        s = s
            .replace(/(が|を|は)?(欲しい|ほしい)(です|だ)?/g, " ")
            .replace(/(探して(ます|います)?|探す|検索|見つけて|教えて|おすすめ|お願い(します)?|ください)/g, " ")
            .replace(/(くらい|ぐらい|かな|かも|です|ます|ですか|でしょう)/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // keep it short-ish
    const tokens = s.split(" ").filter(Boolean);
    return tokens.slice(0, 10).join(" ").trim() || String(userText || "").trim();
}

async function openaiJson(messages, timeoutMs = 12000) {
    if (!OPENAI_API_KEY) return null;

    const r = await fetchWithTimeout(
        `${OPENAI_API_BASE}/v1/chat/completions`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages,
            }),
        },
        timeoutMs
    ).catch(() => null);

    if (!r) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;

    try { return JSON.parse(j.choices?.[0]?.message?.content || "{}"); }
    catch { return null; }
}

/**
 * Build query plan:
 * - display_query: user's language, keyword-style (spaces between tokens)
 * - jd_query_zh: Simplified Chinese, keyword-style
 * - en_query: English fallback
 */
async function buildQueryPlanLLM({ userText, pageContext, userLang, siteHost, allowBudget }) {
    const ctx = String(pageContext || "").slice(0, 900);

    const system = `
You write SHORT SEARCH-BAR queries for e-commerce.

Return JSON with EXACT keys:
{
  "display_query": "...",   // user's language (${userLang}), keyword-style (NOT a sentence)
  "jd_query_zh": "...",     // Simplified Chinese for JD search bar, keyword-style
  "en_query": "..."         // short English fallback query
}

Rules (very important):
- DO NOT invent any constraints not stated by the user.
- NEVER invent numeric price limits.
  - Only include numeric budget/price if BudgetExplicit is YES.
- Make "display_query" look like what users type into a search bar:
  - no polite endings, no full sentences, no punctuation.
  - use spaces between major tokens where possible.
  - keep it short (around 3-8 tokens).
- For "jd_query_zh":
  - Simplified Chinese, tokens separated by spaces, no punctuation, <= 8 tokens.
  - If BudgetExplicit is YES and budget is in JPY, you MAY convert using 1 CNY ≈ 20 JPY.
- Use PageContext ONLY if the user refers to it ("this page", "same as this").
`;

    const user = `
User request:
${userText}

User language: ${userLang}
Current host: ${siteHost || "(none)"}
BudgetExplicit: ${allowBudget ? "YES" : "NO"}

PageContext:
${ctx || "(none)"}
`;

    const obj = await openaiJson(
        [{ role: "system", content: system.trim() }, { role: "user", content: user.trim() }],
        12000
    );

    if (!obj) return null;

    return {
        display_query: normalizeSpaces(obj.display_query || ""),
        zh_query: normalizeSpaces(obj.jd_query_zh || ""),
        en_query: normalizeSpaces(obj.en_query || ""),
    };
}

function uniqQueries(arr) {
    const seen = new Set();
    const out = [];
    for (const it of arr || []) {
        const q = normalizeSpaces(it?.q || "");
        const lang = normalizeSpaces(it?.lang || "");
        if (!q || !lang) continue;
        const key = `${q}||${lang}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ q, lang });
    }
    return out;
}

function limitTokensBySpace(q, maxTokens = 8) {
    const s = normalizeSpaces(q);
    if (!s) return "";
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length <= maxTokens) return s;
    return tokens.slice(0, maxTokens).join(" ");
}

async function generateMultiQueries({ userText, pageContext, userLang, siteHost, isJDMode }) {
    const allowBudget = hasExplicitNumericBudget(userText);

    // No OpenAI -> fallback
    if (!OPENAI_API_KEY) {
        const display_query = fallbackDisplayQuery(userText, userLang);
        const keyword_zh = isJDMode ? "" : "";
        const queries = uniqQueries([
            isJDMode ? { q: keyword_zh, lang: "zh-CN" } : null,
            { q: display_query, lang: userLang },
            { q: display_query, lang: "en-US" },
        ].filter(Boolean));
        return { display_query, keyword_zh, queries };
    }

    const plan = await buildQueryPlanLLM({
        userText,
        pageContext,
        userLang,
        siteHost,
        allowBudget
    });

    let display_query = normalizeSpaces(plan?.display_query || "");
    let zh_query = normalizeSpaces(plan?.zh_query || "");
    let en_query = normalizeSpaces(plan?.en_query || "");

    // If budget is NOT explicit, force-remove any budget-like fragments.
    if (!allowBudget) {
        display_query = stripBudgetConstraints(display_query);
        zh_query = stripBudgetConstraints(zh_query);
        en_query = stripBudgetConstraints(en_query);
    }

    // Ensure display_query is keyword-style (not sentence-like)
    const cmpUser = normalizeForCompare(userText);
    const cmpDisp = normalizeForCompare(display_query);
    if (!display_query || cmpDisp === cmpUser || looksTooSentenceLike(display_query, userLang)) {
        display_query = fallbackDisplayQuery(userText, userLang);
    }

    // Ensure zh query exists in JD mode
    if (isJDMode && !zh_query) {
        // fallback: very short version from userText (still better than nothing)
        zh_query = normalizeSpaces(userText);
    }

    // Enforce short queries
    display_query = normalizeSpaces(display_query);
    en_query = normalizeSpaces(en_query || display_query);
    zh_query = limitTokensBySpace(zh_query, 8);

    // If budget explicit, provide a no-budget zh variant for recall
    const zh_no_budget = allowBudget ? stripBudgetConstraints(zh_query) : zh_query;
    const zh_variants = [];
    if (isJDMode && zh_query) zh_variants.push(zh_query);
    if (isJDMode && allowBudget && zh_no_budget && zh_no_budget !== zh_query) zh_variants.push(zh_no_budget);

    const queries = [];
    for (const q of zh_variants) queries.push({ q, lang: "zh-CN" });
    queries.push({ q: display_query, lang: userLang });
    queries.push({ q: en_query || display_query, lang: "en-US" });

    const finalQueries = uniqQueries(queries);

    const keyword_zh =
        (isJDMode ? (finalQueries.find(x => String(x.lang).toLowerCase().startsWith("zh"))?.q || zh_query) : "") || "";

    return { display_query, keyword_zh, queries: finalQueries };
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "", siteHost = "", provider = "", clientScrape = false } = await readJson(req);

        const { userText, pageContext } = splitUserAndContext(text);
        const safeUserText = String(userText).slice(0, 2000);
        const safeContext = String(pageContext).slice(0, 1200);

        const host = sanitizeHost(siteHost);
        const providerNorm = String(provider || "").toLowerCase().trim();
        const isJDMode = providerNorm === "jd" || isJdHost(host) || looksLikeJDQuery(safeUserText);

        const hintNorm = normalizeLangHint(lang);
        const base = hintNorm ? langBase(hintNorm) : detectLangHeuristic(safeUserText);
        const userLang = hintNorm || toBcp47(base);

        const ui = getUiStrings(userLang);

        const { display_query, keyword_zh, queries } = await generateMultiQueries({
            userText: safeUserText,
            pageContext: safeContext,
            userLang,
            siteHost: host,
            isJDMode
        });

        return res.status(200).json({
            ok: true,
            reply_lang: userLang,
            provider: isJDMode ? "jd" : providerNorm,
            site_host: host,
            keyword_zh: String(keyword_zh || "").trim(),
            display_query: String(display_query || safeUserText).trim(),
            queries: Array.isArray(queries) ? queries : [],
            messages: [{ role: "assistant", type: "text", content: ui.refine }],
            clientScrape: !!clientScrape,
        });

    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
