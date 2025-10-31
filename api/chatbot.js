// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// ========== small utils ==========
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 5000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { ...opt, signal: ctrl.signal });
        return r;
    } finally {
        clearTimeout(id);
    }
}

function isEcomHost(host = "") {
    const h = host.toLowerCase();
    return (
        h.includes("jd.com") ||
        h.includes("amazon.") ||
        h.includes("rakuten.") ||
        h.includes("yahoo.co.jp") ||
        h.includes("taobao.") ||
        h.includes("tmall.")
    );
}

function buildSiteSearchUrl(host, q) {
    const h = host.toLowerCase();
    const enc = encodeURIComponent(q);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${enc}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${enc}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${enc}/`;
    return `https://${host}/search?q=${enc}`;
}

// ========== 1. detect user input language (global) ==========
async function detectTextLangGlobal(text, fallback = "en") {
    const system = `
You are a language detector.
Return ONLY JSON like {"lang_code":"xx"}.
Support ANY language (en, ja, zh, ko, th, ru, pt, es, fr, ar, de, it, tr, vi, id, hi, ...).
`;
    const resp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: text }
            ]
        })
    });
    const j = await resp.json();
    if (!resp.ok) return fallback;
    try {
        const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
        return obj.lang_code || fallback;
    } catch {
        return fallback;
    }
}

// ========== 2. UI strings in user language ==========
async function getUiStrings(langCode) {
    // 3言語は手持ち
    if (langCode.startsWith("ja")) {
        return {
            found: "以下が見つかりました。",
            other: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。",
            notFound: "すみません、今回は見つかりませんでした。もう少しキーワードや条件を入れてください。",
            refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
        };
    }
    if (langCode.startsWith("zh")) {
        return {
            found: "找到了以下商品。",
            other: "当前站点没找到，我从其他平台给你找了一些。",
            notFound: "这次没有找到，请再补充一点关键词或条件。",
            refine: "说下预算/品牌/用途，我可以再筛选。"
        };
    }
    if (langCode.startsWith("en")) {
        return {
            found: "Here are the products I found.",
            other: "Not found on this site, but here are options from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }

    // それ以外はLLMに訳してもらう
    const system = `
You are a translation helper.
Translate these 4 short UI texts for an e-commerce chatbot.
Return ONLY JSON:
{"found":"...","other":"...","notFound":"...","refine":"..."}
`;
    const user = `
Target language: ${langCode}
1) "Here are the products I found."
2) "Not found on this site, but here are options from other sources."
3) "I couldn’t find it this time. Please add more keywords or constraints."
4) "Tell me budget/brand/use case to refine."
`;
    const resp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const j = await resp.json();
    if (!resp.ok) {
        return {
            found: "Here are the products I found.",
            other: "Not found on this site, but here are options from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }
    try {
        const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
        return {
            found: obj.found || "Here are the products I found.",
            other: obj.other || "Not found on this site, but here are options from other sources.",
            notFound: obj.notFound || "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: obj.refine || "Tell me budget/brand/use case to refine."
        };
    } catch {
        return {
            found: "Here are the products I found.",
            other: "Not found on this site, but here are options from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }
}

// ========== 3. site-search-lang (just to *try* site first) ==========
function detectSiteSearchLang(host = "", userLang = "en") {
    const h = host.toLowerCase();
    if (h.includes("jd.com")) return "zh-CN";
    return userLang;
}

// ========== 4. LLMで「複数の検索クエリ」を一気に出す ==========
// ※ Lenovo専用・日本語専用などは一切やらない
async function generateMultiQueries(userText, userLang, siteLang, siteHost = "") {
    const system = `
You are an e-commerce query generator.
Goal: from ONE user message, produce SEVERAL alternative search queries so that at least one will match some products.
Return EXACT JSON:
{
  "queries": [
    {"q": "...", "lang": "..."},
    ...
  ]
}
Rules:
1. First query: optimized for the given site language (if it is different from user language).
2. Second query: in the user's original language.
3. Third query: in English (global) describing the same intent.
4. Fourth query (optional): more generic / shorter version (e.g. remove location, remove adjectives).
5. DO NOT hardcode example brands. Always use what the user said.
If the user didn't mention brand, just search the category.
`;
    const user = `
User message: ${userText}
User language: ${userLang}
Site language to target first: ${siteLang}
Current site host: ${siteHost || "(none)"}
`;
    const resp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "gpt-4.1-mini",
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ]
        })
    });
    const j = await resp.json();
    if (!resp.ok) {
        // 最悪でも元の文と英語だけ返す
        return [
            { q: userText, lang: userLang },
            { q: "laptop", lang: "en-US" }
        ];
    }
    try {
        const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
        if (Array.isArray(obj.queries) && obj.queries.length > 0) {
            // 重複除去して最大6件
            const seen = new Set();
            const out = [];
            for (const item of obj.queries) {
                if (!item?.q) continue;
                const key = item.q + "||" + (item.lang || "");
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                    q: item.q,
                    lang: item.lang || userLang
                });
                if (out.length >= 6) break;
            }
            return out;
        }
    } catch {
        // ignore
    }
    return [
        { q: userText, lang: userLang },
        { q: "laptop", lang: "en-US" }
    ];
}

// ========== main ==========
module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

        // 1) ユーザーの入力言語（UIはこれで固定）
        const userLang = await detectTextLangGlobal(text, lang);

        // 2) UI文言
        const ui = await getUiStrings(userLang);

        // 3) サイト向けに最初に試す言語（でもサイトに縛らない）
        const siteLang = detectSiteSearchLang(siteHost, userLang);

        // 4) 検索クエリを複数本つくる（siteLang版 / userLang版 / 英語版 / 汎用版）
        const queries = await generateMultiQueries(text, userLang, siteLang, siteHost);

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";
        let foundItems = [];
        let foundFrom = ""; // "site" or "global"

        // 5) まず「今いるサイト」で全クエリを試す（でもヒットしなければすぐ他サイトに移る）
        if (siteHost) {
            for (const { q, lang: qlang } of queries) {
                try {
                    const r = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost, lang: qlang })
                        },
                        6000
                    );
                    const j = await r.json().catch(() => null);
                    if (j?.ok && Array.isArray(j.items) && j.items.length > 0) {
                        foundItems = j.items;
                        foundFrom = "site";
                        break;
                    }
                } catch {
                    // ignore, try next
                }
            }
        }

        // 6) サイトで見つからなかったら → サイト指定なしで同じクエリを回す
        if (foundItems.length === 0) {
            for (const { q, lang: qlang } of queries) {
                try {
                    const r2 = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost: "", lang: qlang })
                        },
                        6000
                    );
                    const j2 = await r2.json().catch(() => null);
                    if (j2?.ok && Array.isArray(j2.items) && j2.items.length > 0) {
                        foundItems = j2.items;
                        foundFrom = "global";
                        break;
                    }
                } catch {
                    // ignore
                }
            }
        }

        // 7) レスポンスを組む（UIは100%ユーザーの言語）
        const messages = [];

        if (foundItems.length > 0) {
            messages.push({
                role: "assistant",
                type: "text",
                content: foundFrom === "site" ? ui.found : ui.other
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: foundItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: ui.refine
            });
        } else {
            // ほんとに何も取れなかったとき
            messages.push({
                role: "assistant",
                type: "text",
                content: ui.notFound
            });
            // 一応「今のサイトで検索」ボタンだけ置いとく（これもユーザーの言語で）
            if (siteHost && isEcomHost(siteHost)) {
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title: userLang.startsWith("ja")
                                ? `${siteHost} で「${text}」を検索`
                                : userLang.startsWith("zh")
                                    ? `在 ${siteHost} 上搜索「${text}」`
                                    : `Search “${text}” on ${siteHost}`,
                            url: buildSiteSearchUrl(siteHost, text),
                            price: "",
                            image: "",
                            source: siteHost
                        }
                    ]
                });
            }
        }

        return res.status(200).json({
            ok: true,
            reply_lang: userLang,
            messages
        });

    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
