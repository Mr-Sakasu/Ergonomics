// api/chatbot.js  (REPLACE WHOLE FILE)
//
// Goal
// - Generate JD search queries in Simplified Chinese (zh-CN) + a display query in the user's language.
// - Do NOT invent constraints (especially numeric price limits).
// - If the user didn't explicitly mention a numeric budget/price limit, NEVER add tokens like "1元以下".
//
// Output (compatible with the extension)
// {
//   ok: true,
//   reply_lang: "<userLang>",
//   provider: "jd",
//   site_host: "<host>",
//   keyword_zh: "<zh query used for JD search>",
//   display_query: "<natural query in user's language>",
//   queries: [{q, lang}, ...],
//   messages: [{ role:"assistant", type:"text", content:"..." }]
// }

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
function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const x of list || []) {
        const v = normalizeSpaces(x);
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
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

/**
 * Decide if the user explicitly provided a numeric budget / price limit.
 * If false, we must NOT include any numeric price constraints in queries.
 */
function hasExplicitNumericBudget(userText = "") {
    const s = String(userText || "");

    const hasDigit = /\d/.test(s);
    const hasCurrency = /(円|¥|jpy|yen|元|块|rmb|cny|￥|\$|usd|eur|€|£|gbp|人民币|日元)/i.test(s);
    const hasLimitWord = /(以下|以内|未満|まで|上限|under|below|less\s+than|up\s+to|<=|<)/i.test(s);

    // CJK numerals + currency (covers "一万円", "五千元" etc)
    const hasCjkNum = /[〇零一二三四五六七八九十百千万億两壹贰叁肆伍陆柒捌玖拾佰仟]/.test(s);

    return (hasDigit && (hasCurrency || hasLimitWord)) || (hasCjkNum && hasCurrency);
}

/**
 * Remove budget-like segments from a query string.
 * Used when the user did NOT explicitly specify a numeric budget.
 *
 * Important: do NOT remove product model numbers (e.g., iPhone 15),
 * so we only remove patterns that include currency/limit words.
 */
function stripBudgetConstraints(q = "") {
    let s = String(q || "");

    // Patterns like "1元以下", "5000 CNY", "under 200", "10万円以内"
    s = s.replace(/\b(?:under|below|less\s+than|up\s+to)\s*\$?\s*\d+(?:\.\d+)?\s*(?:usd|dollars|cny|rmb|jpy|yen|円|元|块)?\b/gi, " ");
    s = s.replace(/\b\d+(?:\.\d+)?\s*(?:usd|dollars|cny|rmb|jpy|yen|円|¥|￥|元|块|€|eur|£|gbp)\s*(?:以下|以内|未満|まで|上限)?\b/gi, " ");
    s = s.replace(/\b\d+(?:\.\d+)?\s*(?:以下|以内|未満)\b/gi, " "); // "2000以下" etc

    // Also remove standalone budget tokens often generated in zh
    s = s.replace(/\b\d{1,6}\s*(?:元|块)\s*(?:以下|以内)\b/gi, " ");

    // Clean extra spaces/punct
    s = s.replace(/[，,。．・/／|｜]+/g, " ");
    return normalizeSpaces(s);
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
 * Build a JD query plan using OpenAI.
 * - Returns { display_query, zh_query, en_query }
 */
async function buildQueryPlanLLM({ userText, pageContext, userLang, siteHost, allowBudget }) {
    const ctx = String(pageContext || "").slice(0, 900);

    const system = `
You are a shopping-search query writer.

Return JSON with EXACT keys:
{
  "display_query": "...",   // in the user's language (${userLang})
  "jd_query_zh": "...",     // Simplified Chinese for JD search bar
  "en_query": "..."         // short English fallback
}

Rules:
- DO NOT invent constraints not stated by the user.
- Especially: NEVER invent numeric price limits. Only include a numeric budget/price limit if the user explicitly mentioned one.
- If the user did NOT mention a numeric budget, do not include words like "元以下" / "块以内" / "under 10" etc.
- Keep each query short and natural (not a sentence).
- For jd_query_zh:
  - Use Simplified Chinese.
  - Prefer spaces between major tokens.
  - Avoid punctuation.
  - If the user mentions a budget in JPY, you may convert approximately using 1 CNY ≈ 20 JPY (but only if budget was explicit).
- Use PageContext only if the user refers to it (e.g., "this page", "same as this").`;

    const user = `
User request:
${userText}

User language: ${userLang}
Current host: ${siteHost || "(none)"}

PageContext:
${ctx || "(none)"}
BudgetExplicit: ${allowBudget ? "YES" : "NO"}
`;

    const obj = await openaiJson(
        [{ role: "system", content: system.trim() }, { role: "user", content: user.trim() }],
        12000
    );

    if (!obj) return null;

    const display = normalizeSpaces(obj.display_query || "");
    const zh = normalizeSpaces(obj.jd_query_zh || "");
    const en = normalizeSpaces(obj.en_query || "");

    return { display_query: display, zh_query: zh, en_query: en };
}

async function generateMultiQueries({ userText, pageContext, userLang, siteLang, siteHost, isJDMode }) {
    const allowBudget = hasExplicitNumericBudget(userText);

    // No OpenAI -> minimal fallback
    if (!OPENAI_API_KEY) {
        const zhFallback = isJDMode ? userText : "";
        const displayFallback = userText;
        const enFallback = userText;

        const queries = uniq([
            isJDMode ? { q: zhFallback, lang: "zh-CN" } : null,
            { q: displayFallback, lang: userLang },
            { q: enFallback, lang: "en-US" },
        ].filter(Boolean).map(x => `${x.q}||${x.lang}`))
            .map((k) => {
                const [q, lang] = k.split("||");
                return { q: normalizeSpaces(q), lang: normalizeSpaces(lang) };
            });

        return {
            display_query: displayFallback,
            keyword_zh: normalizeSpaces(zhFallback) || "",
            queries
        };
    }

    const plan = await buildQueryPlanLLM({
        userText,
        pageContext,
        userLang,
        siteHost,
        allowBudget
    });

    let display_query = normalizeSpaces(plan?.display_query || userText);
    let zh_query = normalizeSpaces(plan?.zh_query || "");
    let en_query = normalizeSpaces(plan?.en_query || userText);

    // If budget NOT explicit, force-remove any budget constraints even if the model tried.
    if (!allowBudget) {
        display_query = stripBudgetConstraints(display_query);
        zh_query = stripBudgetConstraints(zh_query);
        en_query = stripBudgetConstraints(en_query);
    }

    // Ensure zh query exists in JD mode
    if (isJDMode && !zh_query) {
        // fallback: use user text (will still work sometimes) but keep short
        zh_query = normalizeSpaces(userText);
    }

    // Keep them short
    display_query = normalizeSpaces(display_query);
    en_query = normalizeSpaces(en_query);
    zh_query = limitTokensBySpace(zh_query, 8);

    // Build zh variants (if budget explicit, add a no-budget variant for recall)
    const zhNoBudget = stripBudgetConstraints(zh_query);
    const zhVariants = uniq([
        zh_query,
        allowBudget && zhNoBudget && zhNoBudget !== zh_query ? zhNoBudget : ""
    ].filter(Boolean));

    const queries = [];
    const push = (q, lang) => {
        const qq = normalizeSpaces(q);
        const ll = normalizeSpaces(lang);
        if (!qq || !ll) return;
        // Final safety: if budget not explicit, do not let budget-ish strings pass
        const safeQ = allowBudget ? qq : stripBudgetConstraints(qq);
        if (!safeQ) return;
        const key = `${safeQ}||${ll}`;
        if (queries.some(x => `${x.q}||${x.lang}` === key)) return;
        queries.push({ q: safeQ, lang: ll });
    };

    if (isJDMode) {
        for (const q of zhVariants) push(q, "zh-CN");
    } else {
        push(userText, siteLang || userLang);
    }

    push(display_query, userLang);
    push(en_query, "en-US");

    const keyword_zh =
        (isJDMode ? (queries.find(q => String(q.lang).toLowerCase().startsWith("zh"))?.q || zh_query) : "") || "";

    return { display_query, keyword_zh, queries };
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
        const siteLang = isJDMode ? "zh-CN" : userLang;

        const { display_query, keyword_zh, queries } = await generateMultiQueries({
            userText: safeUserText,
            pageContext: safeContext,
            userLang,
            siteLang,
            siteHost: host,
            isJDMode
        });

        const payload = {
            ok: true,
            reply_lang: userLang,
            provider: isJDMode ? "jd" : providerNorm,
            site_host: host,
            keyword_zh: String(keyword_zh || "").trim(),
            display_query: String(display_query || safeUserText).trim(),
            queries: Array.isArray(queries) ? queries : [],
            messages: [{ role: "assistant", type: "text", content: ui.refine }]
        };

        // extension does scraping
        return res.status(200).json(payload);

    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
