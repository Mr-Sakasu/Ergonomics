// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 7000) {
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
    if (b === "ja") return {
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
    };
    if (b === "zh") return {
        refine: "说下预算/品牌/用途，我可以再筛选。"
    };
    return {
        refine: "Tell me budget/brand/use case to refine."
    };
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

async function openaiJson(messages, timeoutMs = 9000) {
    if (!OPENAI_API_KEY) return null;

    const r = await fetchWithTimeout(
        `${OPENAI_API_BASE}/v1/chat/completions`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "gpt-4.1-mini",
                response_format: { type: "json_object" },
                messages
            })
        },
        timeoutMs
    ).catch(() => null);

    if (!r) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;

    try { return JSON.parse(j.choices?.[0]?.message?.content || "{}"); }
    catch { return null; }
}

async function generateMultiQueries({ userText, pageContext, userLang, siteLang, siteHost }) {
    if (!OPENAI_API_KEY) {
        return [
            { q: userText, lang: siteLang || userLang || "en-US" },
            { q: userText, lang: userLang || "en-US" },
            { q: userText, lang: "en-US" }
        ];
    }

    const system = `
You are an e-commerce query generator.
Return EXACT JSON:
{ "queries": [ {"q":"...","lang":"..."}, ... ] }

Rules:
- First query MUST be optimized for site language.
- If site language is zh-CN (JD), the first query should be a SHORT simplified-Chinese shopping keyword
  (no punctuation, no explanations, no brand/spec invention, keep it concise).
- Second query MUST be user language.
- Third query MUST be English.
- Optional: even shorter/generic.
- Do NOT invent brands/specs.
- Use PageContext only if user request refers to it (e.g., "this", "same as this page").
`;

    const ctx = String(pageContext || "").slice(0, 900);
    const user = `
User request:
${userText}

User language: ${userLang}
Site language (try first): ${siteLang}
Current site host: ${siteHost || "(none)"}

PageContext (optional):
${ctx || "(none)"}
`;

    const obj = await openaiJson(
        [{ role: "system", content: system }, { role: "user", content: user }],
        9500
    );

    const raw = Array.isArray(obj?.queries) ? obj.queries : [];
    const seen = new Set();
    const out = [];
    for (const it of raw) {
        const q = String(it?.q || "").trim();
        const lang = String(it?.lang || userLang || "en-US").trim();
        if (!q) continue;
        const key = `${q}||${lang}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ q, lang });
        if (out.length >= 6) break;
    }
    return out.length ? out : [
        { q: userText, lang: siteLang || userLang || "en-US" },
        { q: userText, lang: userLang || "en-US" },
        { q: userText, lang: "en-US" }
    ];
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

        // ★ ここが重要：拡張機能側でスクレイピングする場合、サーバ側は「クエリ生成だけ」返す
        if (clientScrape) {
            return res.status(200).json({
                ok: true,
                reply_lang: userLang,
                provider: isJDMode ? "jd" : providerNorm,
                site_host: host,
                keyword_zh: keywordZh,
                queries,
                messages: [
                    { role: "assistant", type: "text", content: ui.refine }
                ]
            });
        }

        // （互換性のため）従来どおりサーバスクレイピングを使いたい場合はここに残せます
        return res.status(200).json({
            ok: true,
            reply_lang: userLang,
            provider: isJDMode ? "jd" : providerNorm,
            site_host: host,
            keyword_zh: keywordZh,
            queries,
            messages: [
                { role: "assistant", type: "text", content: ui.refine }
            ]
        });
    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
