// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// --------------------------------------------------
// common helpers
// --------------------------------------------------
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

function localeMsg(uiLang, key) {
    const ja = {
        found: "以下が見つかりました。",
        otherSite: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。",
        notFound: "すみません、今回は見つかりませんでした。もう少しキーワードや条件を入れてください。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
    };
    const zh = {
        found: "找到了以下商品。",
        otherSite: "当前站点没找到，我从其他平台给你找了一些。",
        notFound: "这次没有找到，请再补充一点关键词或条件。",
        refine: "说下预算/品牌/用途，我可以再筛选。"
    };
    const en = {
        found: "Here are the products I found.",
        otherSite: "Not found on this site, but here are some from other sources.",
        notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
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

// --------------------------------------------------
// 1) ユーザーの入力が何語かを判定（UI用）
// --------------------------------------------------
async function detectTextLang(text, fallbackLang = "en-US") {
    const system = `
You are a language detector.
Detect whether the text is Japanese, Chinese, or English.
Return EXACT JSON: {"lang_code":"ja"|"zh"|"en"}
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
    if (!resp.ok) {
        return fallbackLang.startsWith("ja")
            ? "ja"
            : fallbackLang.startsWith("zh")
                ? "zh"
                : "en";
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    if (obj.lang_code === "ja" || obj.lang_code === "zh" || obj.lang_code === "en") {
        return obj.lang_code;
    }
    return fallbackLang.startsWith("ja")
        ? "ja"
        : fallbackLang.startsWith("zh")
            ? "zh"
            : "en";
}

// --------------------------------------------------
// 2) サイト側の検索に合わせる言語を決める
// --------------------------------------------------
function detectSiteSearchLang(host = "", uiLang = "en-US") {
    const h = host.toLowerCase();

    // JDは中国語のほうが当たる
    if (h.includes("jd.com")) return "zh-CN";

    // 日本のECは日本語
    if (
        h.includes("amazon.co.jp") ||
        h.includes("rakuten.co.jp") ||
        h.includes("rakuten.jp") ||
        h.includes("shopping.yahoo.co.jp") ||
        h.includes("yahoo.co.jp")
    ) {
        return "ja-JP";
    }

    // それ以外はユーザーの言語で
    return uiLang;
}

// --------------------------------------------------
// 3) ★改良版★ クエリを複数本つくる
//    - queries[0]: いちばん素直なもの
//    - queries[1]: brand + category
//    - queries[2]: brand only
//    - queries[3]: 英語ブランド（fallback）
// --------------------------------------------------
async function generateSearchQueries(userText, targetLang, siteHost = "") {
    const system = `
You are an e-commerce query normalizer.
Goal:
- User may say very vague things like "I want a Lenovo PC" or "想买新的电脑".
- You must generate MULTIPLE search queries that are likely to hit on the target site.
- Output EXACT JSON only.
- FIRST query: the best, specific one.
- SECOND query: brand + category (e.g. "联想 笔记本电脑", "レノボ ノートパソコン").
- THIRD query: brand only (e.g. "Lenovo", "联想", "レノボ").
- FOURTH query (optional): English brand+category (e.g. "Lenovo laptop") to increase recall.
Response schema:
{
  "queries": ["string", "string", "string", "string"]
}
All queries should be in the target language if possible, but you may include an English variant in the last position.
`;
    const user = `
Target language: ${targetLang}
Site: ${siteHost || "(none)"}
User text: ${userText}
Brand and model should be explicit if user implied them.
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
        // 壊れたら1本だけ返す
        return [userText];
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    if (Array.isArray(obj.queries) && obj.queries.length > 0) {
        // 空文字を除いて最大4本にする
        return obj.queries.filter(q => q && q.trim()).slice(0, 4);
    }
    return [userText];
}

// --------------------------------------------------
// main
// --------------------------------------------------
module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

        // 1) UI用の言語（ユーザーが打った言語）を決める
        const detected = await detectTextLang(text, lang);
        const uiLang =
            detected === "ja" ? "ja-JP" :
                detected === "zh" ? "zh-CN" :
                    "en-US";

        // 2) 検索に使う言語をサイトに合わせて決める
        const searchLang = detectSiteSearchLang(siteHost, uiLang);

        // 3) その検索言語で「複数本」クエリをつくる
        const queries = await generateSearchQueries(text, searchLang, siteHost);

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let foundItems = [];
        let foundFrom = ""; // "site" | "global" | ""

        // 4) まず「今いるサイト」でクエリを順番に試す
        if (siteHost) {
            for (const q of queries) {
                try {
                    const r = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost, lang: searchLang })
                        },
                        5500
                    );
                    const j = await r.json().catch(() => null);
                    if (j?.ok && Array.isArray(j.items) && j.items.length > 0) {
                        foundItems = j.items;
                        foundFrom = "site";
                        break;
                    }
                } catch {
                    // 次のクエリへ
                }
            }
        }

        // 5) サイトでは見つからなかった場合、サイト指定なしで同じクエリを順番に試す
        if (foundItems.length === 0) {
            for (const q of queries) {
                try {
                    const r2 = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost: "", lang: searchLang })
                        },
                        5500
                    );
                    const j2 = await r2.json().catch(() => null);
                    if (j2?.ok && Array.isArray(j2.items) && j2.items.length > 0) {
                        foundItems = j2.items;
                        foundFrom = "global";
                        break;
                    }
                } catch {
                    // 次のクエリ
                }
            }
        }

        // 6) 応答を組む（UIは常に uiLang で）
        const messages = [];

        if (foundItems.length > 0) {
            // どこかで見つかった
            if (foundFrom === "site") {
                messages.push({
                    role: "assistant",
                    type: "text",
                    content: localeMsg(uiLang, "found")
                });
            } else {
                messages.push({
                    role: "assistant",
                    type: "text",
                    content: localeMsg(uiLang, "otherSite")
                });
            }
            messages.push({
                role: "assistant",
                type: "products",
                items: foundItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "refine")
            });
        } else {
            // ほんとうに全クエリでダメだったとき
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "notFound")
            });

            // ECサイトにいるなら「このサイトで検索」だけ出す
            if (siteHost && isEcomHost(siteHost)) {
                // 一番最初に作ったクエリか、なければユーザーの原文を使う
                const q0 = queries[0] || text;
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title: uiLang.startsWith("ja")
                                ? `${siteHost} で「${q0}」を検索`
                                : uiLang.startsWith("zh")
                                    ? `在 ${siteHost} 上搜索「${q0}」`
                                    : `Search “${q0}” on ${siteHost}`,
                            url: buildSiteSearchUrl(siteHost, q0),
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
            reply_lang: uiLang,
            messages
        });
    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
