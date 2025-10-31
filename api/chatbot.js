// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// ----------------- helpers -----------------
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

// ユーザーに見せる言語（UI用）を決める
function normalizeUiLang(userLang = "en-US") {
    if (userLang.startsWith("ja")) return "ja-JP";
    if (userLang.startsWith("zh")) return "zh-CN";
    return "en-US";
}

// サイト側で“この言語で検索したほうがいい”というのを決める
function detectSiteSearchLang(host = "") {
    const h = host.toLowerCase();
    // JD は中国語でないとほぼヒットしないので固定
    if (h.includes("jd.com")) return "zh-CN";
    // 他のサイトは「特に指定なし」
    return null;
}

// UIメッセージ
function localeMsg(uiLang, key) {
    const ja = {
        found: "以下が見つかりました。",
        otherSite: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。",
        notFound: "すみません、その条件では商品が見つかりませんでした。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
    };
    const zh = {
        found: "找到了以下商品。",
        otherSite: "当前站点没找到，我从其他站点拉了一些候选。",
        notFound: "抱歉，没有找到符合条件的商品。",
        refine: "说下预算/品牌/用途，我可以再筛选。"
    };
    const en = {
        found: "Here are the products I found.",
        otherSite: "Not found on this site, but here are results from other sources.",
        notFound: "Sorry, I couldn’t find matching products.",
        refine: "Tell me budget/brand/use case to refine."
    };
    const L = uiLang.startsWith("ja") ? ja : uiLang.startsWith("zh") ? zh : en;
    return L[key];
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

function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${q}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
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

// ----------------- LLM: クエリ正規化 -----------------
async function normalizeQueryToLang(userText, targetLang, siteHost = "") {
    // targetLang は "ja-JP" / "zh-CN" / "en-US" を想定
    const system = `
You are an e-commerce query normalizer.
- Rewrite the user's text into ONE search query for a product site.
- Output EXACT JSON, no explanation.
- If a target language is given, write the query in that language.
Response schema:
{
  "query": "string"
}
`;
    const user = `
User text: ${userText}
Target language for the query: ${targetLang}
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
    if (!resp.ok) throw new Error(j?.error?.message || "openai error");

    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return obj.query || userText;
}

// ----------------- main -----------------
module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

        // ① 画面に出すときの言語（←ユーザーの言語をそのまま使う！）
        const uiLang = normalizeUiLang(lang); // これだけを表示に使う

        // ② 検索に使う言語（JDだけ中国語、それ以外はユーザーの言語）
        const siteSearchLang = detectSiteSearchLang(siteHost) || uiLang;

        // ③ まず「サイトの言語」でクエリを作る
        const queryForSite = await normalizeQueryToLang(text, siteSearchLang, siteHost);

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let siteItems = [];
        let globalItems = [];
        let userLangItems = [];

        // 1) 今いるサイトで検索（サイト言語のクエリ）
        if (siteHost) {
            try {
                const r = await fetchWithTimeout(
                    `${SHOP_BASE}/api/shop`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: queryForSite, siteHost, lang: siteSearchLang })
                    },
                    5500
                );
                const j = await r.json().catch(() => null);
                if (j?.ok && Array.isArray(j.items)) {
                    siteItems = j.items;
                }
            } catch {
                // 無視
            }
        }

        // 2) サイトで0件なら → サイト指定なしで同じクエリを投げる
        if (siteItems.length === 0) {
            try {
                const r2 = await fetchWithTimeout(
                    `${SHOP_BASE}/api/shop`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: queryForSite, siteHost: "", lang: siteSearchLang })
                    },
                    5500
                );
                const j2 = await r2.json().catch(() => null);
                if (j2?.ok && Array.isArray(j2.items)) {
                    globalItems = j2.items;
                }
            } catch {
                // 無視
            }
        }

        // 3) それでも0件で、かつ「検索に使った言語」と「ユーザーの言語」が違っていたら
        //    → ユーザーの言語でもう一回クエリを作ってグローバル検索
        if (siteItems.length === 0 && globalItems.length === 0 && siteSearchLang !== uiLang) {
            try {
                const queryForUserLang = await normalizeQueryToLang(text, uiLang, "");
                const r3 = await fetchWithTimeout(
                    `${SHOP_BASE}/api/shop`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ query: queryForUserLang, siteHost: "", lang: uiLang })
                    },
                    5500
                );
                const j3 = await r3.json().catch(() => null);
                if (j3?.ok && Array.isArray(j3.items)) {
                    userLangItems = j3.items;
                }
            } catch {
                // 無視
            }
        }

        // ----------------- 応答を組む（ここは必ず uiLang を使う！） -----------------
        const messages = [];

        if (siteItems.length > 0) {
            // 今のサイトでちゃんと見つかった
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "found")
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: siteItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "refine")
            });
        } else if (globalItems.length > 0) {
            // サイトではダメだったけど他のソースにはあった
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "otherSite")
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: globalItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "refine")
            });
        } else if (userLangItems.length > 0) {
            // サイト言語でもダメだったけど、ユーザー言語で探したら出た
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "otherSite")
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: userLangItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "refine")
            });
        } else {
            // ほんとに何もなかった
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "notFound")
            });

            // でもECサイトにいるなら「このサイトで検索」は出す（言語はuiLang）
            if (siteHost && isEcomHost(siteHost)) {
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title: uiLang.startsWith("ja")
                                ? `${siteHost} で「${text}」を検索`
                                : uiLang.startsWith("zh")
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
            reply_lang: uiLang,   // ← ここもユーザー言語で返す
            messages
        });

    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
