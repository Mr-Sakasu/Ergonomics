// api/chatbot.js  (REPLACE WHOLE FILE)
//
// Goal: "shopping query extraction" NOT translation.
// - For JD (zh-CN), produce SHORT tokenized Chinese queries with constraints.
// - Output is compatible with extension: { queries: [{q,lang}, ...], keyword_zh, provider, ... }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 9000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
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

async function openaiJson(messages, timeoutMs = 11000) {
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
function uniqTokens(tokens) {
    const seen = new Set();
    const out = [];
    for (const t of tokens || []) {
        const v = normalizeSpaces(t).replace(/[，,。．・/／|｜]+/g, " ").trim();
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}
function clampInt(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    const y = Math.round(x);
    return Math.max(min, Math.min(max, y));
}

/**
 * Build tokenized zh queries for JD from structured parse.
 * - Always produce:
 *   1) with price (if available)
 *   2) without price
 *   3) synonym/variant (if provided)
 */
function buildZhQueriesFromParsed(parsed = {}) {
    const kw = Array.isArray(parsed.keywords_zh) ? parsed.keywords_zh : [];
    const attrs = Array.isArray(parsed.attrs_zh) ? parsed.attrs_zh : [];
    const syn = Array.isArray(parsed.synonyms_zh) ? parsed.synonyms_zh : [];

    const baseTokens = uniqTokens([
        ...kw,
        ...attrs,
    ]);

    // price
    const maxCny = clampInt(parsed?.price?.max_cny, 1, 99999);
    const priceToken1 = maxCny ? `${maxCny}元以下` : "";
    const priceToken2 = maxCny ? `${maxCny}块以下` : "";

    const qWithPrice = uniqTokens([...baseTokens, priceToken1]).join(" ").trim();
    const qWithPriceAlt = uniqTokens([...baseTokens, priceToken2]).join(" ").trim();
    const qNoPrice = uniqTokens([...baseTokens]).join(" ").trim();

    // synonym variant: mix some synonyms but keep short
    const qSyn = uniqTokens([...baseTokens, ...syn]).slice(0, 8).join(" ").trim();

    return uniq([qWithPrice, qWithPriceAlt, qNoPrice, qSyn]).filter(Boolean);
}

/**
 * Fallback: if LLM parse missing price, try simple yen/cny extraction.
 * This is not the main logic; it's only to avoid catastrophic failures.
 */
function heuristicPriceMaxCny(userText = "") {
    const s = String(userText || "");
    // JPY
    const mY = s.match(/(\d+(?:\.\d+)?)\s*(円|¥|yen|jpy)/i);
    if (mY) {
        const jpy = parseFloat(mY[1]);
        if (Number.isFinite(jpy)) return clampInt(jpy / 20, 1, 99999);
    }
    // CNY
    const mC = s.match(/(\d+(?:\.\d+)?)\s*(元|块|rmb|cny)/i);
    if (mC) {
        const cny = parseFloat(mC[1]);
        if (Number.isFinite(cny)) return clampInt(cny, 1, 99999);
    }
    return null;
}

async function generateMultiQueries({ userText, pageContext, userLang, siteLang, siteHost }) {
    // No OpenAI -> minimal fallback
    if (!OPENAI_API_KEY) {
        return [
            { q: userText, lang: siteLang || userLang || "en-US" },
            { q: userText, lang: userLang || "en-US" },
            { q: userText, lang: "en-US" },
        ];
    }

    const isJd = String(siteLang || "").toLowerCase().startsWith("zh");
    const ctx = String(pageContext || "").slice(0, 900);

    const system = `
You are an e-commerce SHOPPING QUERY EXTRACTOR (NOT a translator).
Return JSON with EXACT keys:
{
  "parsed": {
    "keywords_zh": ["..."],      // Simplified-Chinese product/category tokens (space-free tokens)
    "attrs_zh": ["..."],         // Simplified-Chinese constraint tokens (e.g., 不辣, 微辣, 轻薄, 无线, 降噪)
    "synonyms_zh": ["..."],      // Optional extra tokens (e.g., 泡面, 杯面, 桶面)
    "price": { "max_cny": 0 }    // If user mentions budget, convert to CNY and set integer max_cny.
  },
  "queries": [
    {"q":"...","lang":"${siteLang}"},
    {"q":"...","lang":"${userLang}"},
    {"q":"...","lang":"en-US"}
  ]
}

HARD RULES for zh-CN (JD):
- The zh query MUST be tokenized for a search bar: use spaces between tokens; no punctuation; no full sentences.
- Extract product/category + constraints. Keep it SHORT (<= 8 tokens).
- If user gives budget in JPY, convert approximately using 1 CNY ≈ 20 JPY.
  - Example: "100円以下" => max_cny = 5 and include token "5元以下".
- "not spicy" => use tokens like "不辣" (preferred) or "微辣" depending on request.
- "cup noodles" => include tokens like "杯面" and also "方便面" as base category.
- DO NOT invent brand/specs not mentioned.
- Provide variants: with price AND without price (because price tokens may reduce recall).
- If not JD / not zh, still produce concise userLang + English queries.

Use PageContext only if user refers to it ("this", "same as this page").
`;

    const user = `
User request:
${userText}

User language: ${userLang}
Site language (primary): ${siteLang}
Current host: ${siteHost || "(none)"}

PageContext:
${ctx || "(none)"}
`;

    const obj = await openaiJson(
        [{ role: "system", content: system.trim() }, { role: "user", content: user.trim() }],
        12000
    );

    const rawQueries = Array.isArray(obj?.queries) ? obj.queries : [];
    const parsed = obj?.parsed && typeof obj.parsed === "object" ? obj.parsed : {};

    // Normalize parsed price (fallback if missing)
    if (!parsed.price || typeof parsed.price !== "object") parsed.price = {};
    if (!Number.isFinite(Number(parsed.price.max_cny)) || Number(parsed.price.max_cny) <= 0) {
        const h = heuristicPriceMaxCny(userText);
        if (h) parsed.price.max_cny = h;
    }

    // Collect final queries (dedupe)
    const out = [];
    const seen = new Set();

    const pushQ = (q, lang) => {
        const qq = normalizeSpaces(q);
        const ll = normalizeSpaces(lang || "");
        if (!qq || !ll) return;
        const key = `${qq}||${ll}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ q: qq, lang: ll });
    };

    // 1) zh-CN (JD) — built from parsed (primary)
    if (isJd) {
        const zhCandidates = buildZhQueriesFromParsed(parsed);
        for (const q of zhCandidates.slice(0, 4)) pushQ(q, "zh-CN");

        // If LLM already provided a zh query, keep it too (as extra variant)
        for (const it of rawQueries) {
            const q = String(it?.q || "");
            const lang = String(it?.lang || "");
            if (lang.toLowerCase().startsWith("zh")) pushQ(q, "zh-CN");
        }
    }

    // 2) user language query (concise)
    const userQ = rawQueries.find(it => String(it?.lang || "").toLowerCase().startsWith(langBase(userLang)));
    pushQ(userQ?.q || userText, userLang);

    // 3) English query
    const enQ = rawQueries.find(it => String(it?.lang || "").toLowerCase().startsWith("en"));
    pushQ(enQ?.q || userText, "en-US");

    // 4) Ensure at least one siteLang query exists
    if (!out.some(x => x.lang === siteLang)) {
        pushQ(userText, siteLang);
    }

    return out.slice(0, 8);
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

        const queries = await generateMultiQueries({
            userText: safeUserText,
            pageContext: safeContext,
            userLang,
            siteLang,
            siteHost: host
        });

        const keywordZh =
            String(
                queries.find(q => String(q?.lang || "").toLowerCase().startsWith("zh"))?.q ||
                queries[0]?.q ||
                safeUserText
            ).trim();

        // Return queries only (extension does scraping)
        if (clientScrape) {
            return res.status(200).json({
                ok: true,
                reply_lang: userLang,
                provider: isJDMode ? "jd" : providerNorm,
                site_host: host,
                keyword_zh: keywordZh,
                queries,
                messages: [{ role: "assistant", type: "text", content: ui.refine }]
            });
        }

        // Same output for compatibility
        return res.status(200).json({
            ok: true,
            reply_lang: userLang,
            provider: isJDMode ? "jd" : providerNorm,
            site_host: host,
            keyword_zh: keywordZh,
            queries,
            messages: [{ role: "assistant", type: "text", content: ui.refine }]
        });
    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
