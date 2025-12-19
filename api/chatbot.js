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
        found: "以下が見つかりました。",
        other: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。",
        notFound: "すみません、今回は見つかりませんでした。もう少しキーワードや条件を入れてください。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
    };
    if (b === "zh") return {
        found: "找到了以下商品。",
        other: "当前站点没找到，我从其他平台给你找了一些。",
        notFound: "这次没有找到，请再补充一点关键词或条件。",
        refine: "说下预算/品牌/用途，我可以再筛选。"
    };
    if (b === "ko") return {
        found: "다음 상품을 찾았어요.",
        other: "이 사이트에서는 못 찾았지만, 다른 소스에서 후보를 찾아봤어요.",
        notFound: "이번에는 찾지 못했어요. 키워드/조건을 조금 더 추가해 주세요.",
        refine: "예산/브랜드/용도를 알려주면 더 좁혀볼게요."
    };
    return {
        found: "Here are the products I found.",
        other: "Not found on this site, but here are options from other sources.",
        notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
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

function buildSiteSearchUrl(host, q) {
    const h = (host || "").toLowerCase();
    const enc = encodeURIComponent(q);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${enc}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${enc}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${enc}/`;
    return host ? `https://${host}/search?q=${enc}` : `https://www.google.com/search?q=${enc}`;
}

function resolveBaseUrl(req) {
    if (process.env.SHOP_BASE) return process.env.SHOP_BASE;
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    const proto = (req?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    const host = req?.headers?.host || "";
    if (host) return `${proto}://${host}`;
    return "https://ergonomics-mu.vercel.app";
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
        // fallback: no OpenAI
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
- Second query MUST be user language.
- Third query MUST be English.
- Optional: shorter/more generic.
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

async function tryShopSearch({ baseUrl, queries, siteHost, provider, timeoutMs = 6500, maxTries = 5 }) {
    for (const { q, lang } of queries.slice(0, maxTries)) {
        try {
            const r = await fetchWithTimeout(
                `${baseUrl}/api/shop`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: q, siteHost: siteHost || "", lang: lang || "en-US", provider: provider || "" })
                },
                timeoutMs
            );
            const j = await r.json().catch(() => null);
            if (j?.ok && Array.isArray(j.items) && j.items.length > 0) return { items: j.items, queryUsed: q };
        } catch { }
    }
    return { items: [], queryUsed: "" };
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "", siteHost = "", provider = "" } = await readJson(req);

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

        const baseUrl = resolveBaseUrl(req);

        const queries = await generateMultiQueries({
            userText: safeUserText,
            pageContext: safeContext,
            userLang,
            siteLang,
            siteHost: host
        });

        let foundItems = [];
        let foundFrom = "";

        // 1) Try site/JD first
        if (host || isJDMode) {
            const r1 = await tryShopSearch({
                baseUrl,
                queries,
                siteHost: host,
                provider: isJDMode ? "jd" : providerNorm,
                maxTries: isJDMode ? 4 : 5
            });
            foundItems = r1.items || [];
            if (foundItems.length) foundFrom = "site";
        }

        // 2) Global fallback only if NOT JD mode
        if (!isJDMode && foundItems.length === 0) {
            const r2 = await tryShopSearch({
                baseUrl,
                queries,
                siteHost: "",
                provider: "",
                maxTries: 5
            });
            foundItems = r2.items || [];
            if (foundItems.length) foundFrom = "global";
        }

        const messages = [];

        if (foundItems.length) {
            messages.push({ role: "assistant", type: "text", content: foundFrom === "site" ? ui.found : ui.other });
            messages.push({ role: "assistant", type: "products", items: foundItems.slice(0, 6) });
            messages.push({ role: "assistant", type: "text", content: ui.refine });
        } else {
            messages.push({ role: "assistant", type: "text", content: ui.notFound });

            const hostForLink = isJDMode ? "jd.com" : host;
            if (hostForLink) {
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [{
                        title: base === "ja"
                            ? `${hostForLink} で「${safeUserText}」を検索`
                            : base === "zh"
                                ? `在 ${hostForLink} 上搜索「${safeUserText}」`
                                : `Search “${safeUserText}” on ${hostForLink}`,
                        url: buildSiteSearchUrl(hostForLink, safeUserText),
                        price: "",
                        image: "",
                        source: hostForLink
                    }]
                });
            }

            messages.push({ role: "assistant", type: "text", content: ui.refine });
        }

        return res.status(200).json({ ok: true, reply_lang: userLang, messages });
    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
