// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// =====================================================
// 基本ヘルパ
// =====================================================
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

// EC判定
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

// ECサイトでの検索URL（APIなし想定）
function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${q}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

// =====================================================
// 1) 入力テキストの言語を「グローバルに」判定
//    → ja / zh / en 以外でも OK にする
//    ここでは ISO 639-1 か BCP47 っぽいのを返させる
// =====================================================
async function detectTextLangGlobal(text, fallback = "en") {
    const system = `
You are a language detector.
- Detect the main language of the user's text.
- Return EXACT JSON.
- Support ANY language (Thai "th", Portuguese "pt", Russian "ru", Arabic "ar", Spanish "es", French "fr", etc.)
- If unsure, pick the closest.
Schema:
{"lang_code":"<iso-like code>"}
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
        return fallback;
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return obj.lang_code || fallback;
}

// =====================================================
// 2) UIメッセージをその言語で用意する
//    - ja / zh / en はハードコード
//    - それ以外は LLM に翻訳してもらう
// =====================================================
async function getUiStrings(langCode) {
    // まず3言語だけ手持ち
    if (langCode.startsWith("ja")) {
        return {
            found: "以下が見つかりました。",
            otherSite: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。",
            notFound: "すみません、今回は見つかりませんでした。もう少しキーワードや条件を入れてください。",
            refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
        };
    }
    if (langCode.startsWith("zh")) {
        return {
            found: "找到了以下商品。",
            otherSite: "当前站点没找到，我从其他平台给你找了一些。",
            notFound: "这次没有找到，请再补充一点关键词或条件。",
            refine: "说下预算/品牌/用途，我可以再筛选。"
        };
    }
    if (langCode.startsWith("en")) {
        return {
            found: "Here are the products I found.",
            otherSite: "Not found on this site, but here are some from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }

    // それ以外 → LLMに翻訳してもらう
    const system = `
You are a translation helper.
Translate the following 4 UI texts for an e-commerce chatbot into the target language.
Return EXACT JSON:
{
  "found": "...",
  "otherSite": "...",
  "notFound": "...",
  "refine": "..."
}
Keep the meaning the same, be short and natural.
`;
    const user = `
Target language: ${langCode}
Texts:
1) "Here are the products I found."
2) "Not found on this site, but here are some from other sources."
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
        // 失敗したら英語に落とす
        return {
            found: "Here are the products I found.",
            otherSite: "Not found on this site, but here are some from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    // 欠けてるところは英語で補う
    return {
        found: obj.found || "Here are the products I found.",
        otherSite: obj.otherSite || "Not found on this site, but here are some from other sources.",
        notFound: obj.notFound || "I couldn’t find it this time. Please add more keywords or constraints.",
        refine: obj.refine || "Tell me budget/brand/use case to refine."
    };
}

// =====================================================
// 3) 検索に使う言語を「サイトに合わせて」決める
//    - JD → zh-CN
//    - 日本EC → ja-JP
//    - その他 → ユーザーの言語（そのまま）
// =====================================================
function detectSiteSearchLang(host = "", userUiLang = "en") {
    const h = host.toLowerCase();

    if (h.includes("jd.com")) return "zh-CN";

    if (
        h.includes("amazon.co.jp") ||
        h.includes("rakuten.co.jp") ||
        h.includes("rakuten.jp") ||
        h.includes("shopping.yahoo.co.jp") ||
        h.includes("yahoo.co.jp")
    ) {
        return "ja-JP";
    }

    // その他 → ユーザーが使った言語で探す
    // (ロシア語で書いたなら ru, タイ語なら th で投げる)
    return userUiLang;
}

// =====================================================
// 4) クエリを複数本つくる（前のメッセージで説明したやつ）
// =====================================================
async function generateSearchQueries(userText, targetLang, siteHost = "") {
    const system = `
You are an e-commerce query normalizer.
Goal:
- User may speak ANY language.
- You must generate MULTIPLE search queries that are likely to hit on the target site.
- Write queries in the target language if possible.
Return EXACT JSON:
{
  "queries": ["q1", "q2", "q3", "q4"]
}
Rules:
- q1: best guess, specific
- q2: brand + category (if there is brand)
- q3: category only / brand only
- q4: optional english or global form
`;
    const user = `
Target language: ${targetLang}
Site: ${siteHost || "(none)"}
User text: ${userText}
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
        return [userText];
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    if (Array.isArray(obj.queries) && obj.queries.length > 0) {
        return obj.queries.filter(q => q && q.trim()).slice(0, 4);
    }
    return [userText];
}

// =====================================================
// メイン処理
// =====================================================
module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

        // 1) ユーザーが何語で書いたかをグローバルに判定
        const langCode = await detectTextLangGlobal(text, lang);   // 例: "th", "pt", "ru", "ja", "zh", ...
        // UIで使う形に直す（"th" → "th", "pt-BR" → "pt-BR" のままでOK）
        const uiLang = langCode; // UIはこのまま使う

        // 2) UIメッセージをその言語で取得（知らない言語はLLMで翻訳）
        const uiStrings = await getUiStrings(uiLang);

        // 3) 検索に使う言語（サイトを優先）
        const searchLang = detectSiteSearchLang(siteHost, uiLang);

        // 4) その検索言語でクエリを複数本つくる
        const queries = await generateSearchQueries(text, searchLang, siteHost);

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let foundItems = [];
        let foundFrom = "";

        // 5) まず「今いるサイト」で順番に試す
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
                } catch { /* 次へ */ }
            }
        }

        // 6) サイトで見つからなかったら → サイト指定なしで順番に試す
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
                } catch { /* 次へ */ }
            }
        }

        // 7) 返すメッセージを組み立てる（UIは必ずユーザーの言語）
        const messages = [];

        if (foundItems.length > 0) {
            messages.push({
                role: "assistant",
                type: "text",
                content: foundFrom === "site" ? uiStrings.found : uiStrings.otherSite
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: foundItems.slice(0, 6)
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: uiStrings.refine
            });
        } else {
            // ほんとに全部ダメだったとき
            messages.push({
                role: "assistant",
                type: "text",
                content: uiStrings.notFound
            });

            // ECサイトなら「このサイトで検索」を1枚だけ出す（タイトルもその言語に）
            if (siteHost && isEcomHost(siteHost)) {
                const q0 = queries[0] || text;
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title:
                                uiLang.startsWith("ja") ? `${siteHost} で「${q0}」を検索` :
                                    uiLang.startsWith("zh") ? `在 ${siteHost} 上搜索「${q0}」` :
                                        // その他の言語でもなるべく自然に
                                        `Search “${q0}” on ${siteHost}`,
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
