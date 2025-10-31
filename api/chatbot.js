// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// =====================================================
// 共通ユーティリティ
// =====================================================
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

// 画面に出すメッセージ（ユーザーの言語だけを見る）
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
        notFound: "这次没有找到，麻烦再多说一点关键词或条件。",
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

// 今いるサイトがECっぽいか
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

// そのサイトでの検索URLをつくる（API使えない前提）
function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${q}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

// fetchにタイムアウトをつける
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

// =====================================================
// 1) ユーザーの入力テキストが何語かを判定する
//    → UIはこれに絶対合わせる
// =====================================================
async function detectTextLang(text, fallbackLang = "en-US") {
    // 超シンプルにやるならここで正規表現でもいいが、今回はLLMで確実にする
    const system = `
You are a language detector.
Detect whether the text is Japanese, Chinese, or English.
Return EXACT JSON like: {"lang_code":"ja"} or {"lang_code":"zh"} or {"lang_code":"en"}
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

// =====================================================
// 2) 内部の検索で使う言語を「サイト側」に寄せて決める
//    ・JD → zh-CN
//    ・amazon.co.jp / rakuten / yahoo.co.jp → ja-JP
//    ・それ以外 → ユーザーの言語(uiLang)
// =====================================================
function detectSiteSearchLang(host = "", uiLang = "en-US") {
    const h = host.toLowerCase();

    // JDは中国語に寄せる
    if (h.includes("jd.com")) return "zh-CN";

    // 日本のECは日本語でヒットしやすいので日本語に
    if (
        h.includes("amazon.co.jp") ||
        h.includes("rakuten.co.jp") ||
        h.includes("rakuten.jp") ||
        h.includes("shopping.yahoo.co.jp") ||
        h.includes("yahoo.co.jp")
    ) {
        return "ja-JP";
    }

    // それ以外はユーザーの言語で検索
    return uiLang;
}

// =====================================================
// 3) 指定した言語で検索しやすいクエリに正規化
// =====================================================
async function normalizeQueryToLang(userText, targetLang, siteHost = "") {
    const system = `
You are an e-commerce query normalizer.
Rewrite the user message into ONE search query in the target language.
Return EXACT JSON: {"query":"..."}
Don't add explanations.
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
        return userText; // フォールバック
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return obj.query || userText;
}

// =====================================================
// main handler
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

        // ① ユーザーが実際に打った言語を判定 → これをUIに使う（絶対）
        const detected = await detectTextLang(text, lang);
        const uiLang =
            detected === "ja" ? "ja-JP" :
                detected === "zh" ? "zh-CN" :
                    "en-US";

        // ② 検索に使う言語はサイトに合わせる
        const searchLang = detectSiteSearchLang(siteHost, uiLang);

        // ③ その検索言語でクエリを1本きれいにする
        const queryForSite = await normalizeQueryToLang(text, searchLang, siteHost);

        // ④ 実際にショップAPIを叩く
        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let siteItems = [];
        let globalItems = [];

        // 1) 今のサイトで検索（サイト言語で）
        if (siteHost) {
            try {
                const r = await fetchWithTimeout(
                    `${SHOP_BASE}/api/shop`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            query: queryForSite,
                            siteHost,
                            lang: searchLang
                        })
                    },
                    5500
                );
                const j = await r.json().catch(() => null);
                if (j?.ok && Array.isArray(j.items)) {
                    siteItems = j.items;
                }
            } catch {
                // 無視して次へ
            }
        }

        // 2) 今のサイトでダメなら → サイト指定なしで同じクエリを投げる
        if (siteItems.length === 0) {
            try {
                const r2 = await fetchWithTimeout(
                    `${SHOP_BASE}/api/shop`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            query: queryForSite,
                            siteHost: "",
                            lang: searchLang
                        })
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

        // ⑤ 応答を組み立てる（ここからは絶対に uiLang だけを使う！）
        const messages = [];

        if (siteItems.length > 0) {
            // 今のサイトで見つかった
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
            // サイトではダメだったけど他からは出た
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
        } else {
            // 本当に何もなかった
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(uiLang, "notFound")
            });

            // ECサイトにいるなら「このサイトで検索」だけは出す（UI言語で）
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
            reply_lang: uiLang,
            messages
        });

    } catch (e) {
        console.error("[chatbot] error", e);
        // extension が壊れないように 200 で返す
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
