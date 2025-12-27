// api/image2query.js (CREATE NEW FILE)
//
// Input (POST JSON):
// - imageBase64: base64 (no data: prefix preferred, but data URL is also accepted)
// - mimeType: e.g. "image/jpeg"
// - lang: user UI language (e.g. "ja-JP")
// - provider: "jd" etc (optional)
//
// Output (JSON):
// - display_query: keyword-style in user's language (NOT a sentence)
// - keyword_zh: Simplified Chinese query for JD search bar (keyword-style)
// - queries: [{q, lang:"zh-CN"}, ...]   // multiple candidates
// - features: ["...", ...]             // extracted attributes/tags (no budget)
//
// Hard requirements:
// - DO NOT invent constraints (esp numeric budgets).
// - Do not include numeric price limits.
// - Only include attributes that are clearly visible or strongly implied.
// - display_query should be short keywords separated by spaces.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// IMPORTANT: use a vision-capable model here.
// If you set OPENAI_MODEL="gpt-4.1-mini" (text-only), this endpoint will fail.
// -> Set OPENAI_VISION_MODEL to a vision model (e.g. "gpt-4o-mini").
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
        return JSON.parse(body || "{}");
    } catch {
        return {};
    }
}

async function fetchWithTimeout(url, opt = {}, ms = 20000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), ms);
    try {
        return await fetch(url, { ...opt, signal: ctrl.signal });
    } finally {
        clearTimeout(id);
    }
}

function normalizeSpaces(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
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
function toBcp47(base = "en") {
    const b = String(base).toLowerCase();
    if (b.startsWith("ja")) return "ja-JP";
    if (b.startsWith("zh")) return "zh-CN";
    if (b.startsWith("ko")) return "ko-KR";
    return "en-US";
}

function looksTooSentenceLike(displayQuery = "", userLang = "en-US") {
    const s = String(displayQuery || "");
    if (!s) return true;
    if (/[。！？\?!.]/.test(s)) return true;

    const b = langBase(userLang);
    if (b === "ja") {
        if (/(です|ます|ください|お願い|欲しい|ほしい|探して|教えて|おすすめ)/.test(s)) return true;
    }
    if (b === "en") {
        if (/\b(i want|i'm looking for|can you|please|recommend)\b/i.test(s)) return true;
    }
    return false;
}

function keywordizeDisplayQuery(s = "") {
    // very light keywordization: remove punctuation-like chars and compress spaces
    let x = String(s || "");
    x = x.replace(/[。\n\r\t]/g, " ");
    x = x.replace(/[、，,。．・/／|｜]+/g, " ");
    x = x.replace(/\s+/g, " ").trim();
    const tokens = x.split(" ").filter(Boolean);
    return tokens.slice(0, 8).join(" ").trim();
}

function limitTokensBySpace(q, maxTokens = 8) {
    const s = normalizeSpaces(q);
    if (!s) return "";
    const tokens = s.split(" ").filter(Boolean);
    if (tokens.length <= maxTokens) return s;
    return tokens.slice(0, maxTokens).join(" ");
}

function stripDataUrlPrefix(imageBase64 = "") {
    const s = String(imageBase64 || "").trim();
    if (!s) return "";
    // accept: data:image/jpeg;base64,....
    const m = s.match(/^data:.*?;base64,(.+)$/i);
    return m ? String(m[1] || "").trim() : s;
}

async function openaiVisionJson({ userLang, imageDataUrl }, timeoutMs = 20000) {
    if (!OPENAI_API_KEY) return null;

    const system = `
You are an e-commerce query generator for JD.com (China).

Return JSON with EXACT keys:
{
  "display_query": "...",     // user's language (${userLang}), keyword-style (NOT a sentence)
  "jd_query_zh": "...",       // Simplified Chinese, keyword-style for JD search bar
  "queries_zh": ["...", ...], // 1-3 additional Simplified Chinese query candidates
  "features": ["...", ...]    // 4-12 short tags/attributes (no prices/budgets)
}

Rules (very important):
- DO NOT invent constraints not visible in the image.
- NEVER invent numeric price limits/budget.
- Avoid numeric specs unless clearly readable on the image (e.g., model name on a box).
- If uncertain about category, choose the broadest safe category (e.g., "手机 配件" rather than a specific model).
- Queries must look like search-bar keywords:
  - no punctuation, no full sentences, no polite endings.
  - use spaces between major tokens.
  - keep jd_query_zh <= 8 tokens.
- features are short attribute tokens (e.g., "轻薄", "黑色", "无线", "双肩", "拉链"), no budgets.
`.trim();

    const user = [
        {
            type: "text",
            text: `
User language: ${userLang}
Task: Identify the product category and visible attributes from the image and generate JD search keywords.
`.trim(),
        },
        {
            type: "image_url",
            image_url: { url: imageDataUrl },
        },
    ];

    const r = await fetchWithTimeout(
        `${OPENAI_API_BASE}/v1/chat/completions`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: OPENAI_VISION_MODEL,
                temperature: 0.2,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                max_tokens: 700,
            }),
        },
        timeoutMs
    ).catch(() => null);

    if (!r) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;

    try {
        return JSON.parse(j.choices?.[0]?.message?.content || "{}");
    } catch {
        return null;
    }
}

function uniqZhQueries(list) {
    const seen = new Set();
    const out = [];
    for (const q of list || []) {
        const s = normalizeSpaces(q);
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const {
            imageBase64 = "",
            mimeType = "image/jpeg",
            lang = "",
            provider = "",
        } = await readJson(req);

        const hintNorm = normalizeLangHint(lang);
        const userLang = hintNorm || toBcp47(langBase(hintNorm || "en-US"));

        const rawB64 = stripDataUrlPrefix(imageBase64);
        if (!rawB64) {
            return res.status(200).json({ ok: false, error: "imageBase64 missing" });
        }

        // Build data URL for OpenAI vision
        const safeMime = String(mimeType || "image/jpeg").trim() || "image/jpeg";
        const imageDataUrl = `data:${safeMime};base64,${rawB64}`;

        // If no OpenAI key, return empty to avoid wrong-category scraping
        if (!OPENAI_API_KEY) {
            return res.status(200).json({
                ok: true,
                reply_lang: userLang,
                provider: String(provider || "").toLowerCase().trim(),
                display_query: "",
                keyword_zh: "",
                features: [],
                queries: [],
            });
        }

        const obj = await openaiVisionJson({ userLang, imageDataUrl }, 20000);
        if (!obj) {
            return res.status(200).json({ ok: false, error: "vision_failed" });
        }

        let display_query = normalizeSpaces(obj.display_query || "");
        let jd_query_zh = normalizeSpaces(obj.jd_query_zh || "");
        let queries_zh = Array.isArray(obj.queries_zh) ? obj.queries_zh : [];
        let features = Array.isArray(obj.features) ? obj.features : [];

        // normalize / enforce keyword style
        if (!display_query || looksTooSentenceLike(display_query, userLang)) {
            display_query = keywordizeDisplayQuery(display_query);
        } else {
            display_query = keywordizeDisplayQuery(display_query);
        }

        // enforce token limits for zh queries
        jd_query_zh = limitTokensBySpace(jd_query_zh, 8);
        queries_zh = uniqZhQueries([jd_query_zh, ...queries_zh]).slice(0, 3).map((q) => limitTokensBySpace(q, 8));

        // features: keep short and safe
        features = features
            .map((x) => normalizeSpaces(x))
            .filter(Boolean)
            .slice(0, 12);

        const queries = queries_zh
            .filter(Boolean)
            .map((q) => ({ q, lang: "zh-CN" }));

        return res.status(200).json({
            ok: true,
            reply_lang: userLang,
            provider: String(provider || "").toLowerCase().trim(),
            display_query: display_query || "",
            keyword_zh: jd_query_zh || (queries[0]?.q || ""),
            features,
            queries,
        });
    } catch (e) {
        console.error("[image2query] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
