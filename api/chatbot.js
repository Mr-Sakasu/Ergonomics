// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// ========== util ==========
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

function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${q}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

// ========== 1. 入力言語をグローバルに判定 ==========
async function detectTextLangGlobal(text, fallback = "en") {
    const system = `
You are a language detector.
Return ONLY JSON like {"lang_code":"xx"}.
Support ANY language (en, ja, zh, ko, th, ru, pt, es, fr, ar, de, ...).
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
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return obj.lang_code || fallback;
}

// ========== 2. UIテキストをその言語で用意する ==========
async function getUiStrings(langCode) {
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

    // その他の言語はLLMで翻訳
    const system = `
You are a translation helper.
Translate these 4 short UI texts into the target language.
Return EXACT JSON:
{"found":"...", "otherSite":"...", "notFound":"...", "refine":"..."}
`;
    const user = `
Target language: ${langCode}
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
        return {
            found: "Here are the products I found.",
            otherSite: "Not found on this site, but here are some from other sources.",
            notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
            refine: "Tell me budget/brand/use case to refine."
        };
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return {
        found: obj.found || "Here are the products I found.",
        otherSite: obj.otherSite || "Not found on this site, but here are some from other sources.",
        notFound: obj.notFound || "I couldn’t find it this time. Please add more keywords or constraints.",
        refine: obj.refine || "Tell me budget/brand/use case to refine."
    };
}

// ========== 3. サイト向け検索言語を決める ==========
function detectSiteSearchLang(host = "", userLang = "en") {
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
    return userLang; // それ以外はそのまま
}

// ========== 4. 商品の意図を抽出して、多言語クエリを生成する ==========
// ここが今回の「弱い気がする」を直したところ
async function extractIntentAndMakeQueries(userText, siteLang, userLang, siteHost = "") {
    // 1回のLLMで「ブランド・カテゴリ・キーワード」を取って、そこから複数クエリを組み立てる
    const system = `
You are a product intent extractor for e-commerce.
Given any user text (any language), you must extract:
- brand (if any, like "Lenovo", "Apple", "华为", "レノボ")
- category (like "laptop", "notebook", "スマホ", "笔记本电脑")
- extra_keywords: other important words (color, price range words, "gaming", "office", ...)
Return EXACT JSON:
{
  "brand": "string or empty",
  "category": "string or empty",
  "extra_keywords": ["...","..."]
}
Do not explain.
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
                { role: "user", content: userText }
            ]
        })
    });
    const j = await resp.json();
    let brand = "";
    let category = "";
    let extra = [];
    if (resp.ok) {
        try {
            const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
            brand = (obj.brand || "").trim();
            category = (obj.category || "").trim();
            extra = Array.isArray(obj.extra_keywords) ? obj.extra_keywords.filter(Boolean) : [];
        } catch {
            // ignore
        }
    }

    // クエリを組み立てる
    // 1) サイト言語での本命
    const queries = [];

    const extraStr = extra.join(" ").trim();

    // --- siteLang 系 ---
    if (brand && category) {
        queries.push({ q: `${brand} ${category} ${extraStr}`.trim(), lang: siteLang });
    }
    if (category) {
        queries.push({ q: `${category} ${extraStr}`.trim(), lang: siteLang });
    }
    if (brand) {
        // ノートPC系でよくある"ThinkPad"も混ぜる
        if (/lenovo/i.test(brand) || /联想/.test(brand) || /レノボ/.test(brand)) {
            queries.push({ q: `${brand} ThinkPad`, lang: siteLang });
        }
        queries.push({ q: `${brand} ${extraStr}`.trim(), lang: siteLang });
    }

    // --- 英語系（グローバルに一番当たりやすい） ---
    // brand + laptop
    if (brand) {
        queries.push({ q: `${brand} laptop`, lang: "en-US" });
        queries.push({ q: `${brand} notebook`, lang: "en-US" });
    }
    // generic laptop
    if (!category) {
        queries.push({ q: "laptop", lang: "en-US" });
    }

    // --- ユーザーの言語でも一応 ---
    if (!userLang.startsWith("en")) {
        if (brand && category) {
            queries.push({ q: `${brand} ${category}`, lang: userLang });
        } else {
            queries.push({ q: userText, lang: userLang });
        }
    }

    // 重複除去
    const seen = new Set();
    const uniq = [];
    for (const { q, lang } of queries) {
        const key = `${q}||${lang}`;
        if (!q) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        uniq.push({ q, lang });
    }

    // 最低でもオリジナルは入れておく
    if (uniq.length === 0) {
        uniq.push({ q: userText, lang: userLang });
    }

    return uniq;
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

        // 1) ユーザー入力の言語をグローバルに判定
        const userLangCode = await detectTextLangGlobal(text, lang);  // ex) "ja", "zh", "th", "pt-BR", ...
        // 2) UI用のテキスト（その言語で）
        const uiStrings = await getUiStrings(userLangCode);
        // 3) サイトに合わせた「検索言語」
        const searchLang = detectSiteSearchLang(siteHost, userLangCode);
        // 4) 多言語クエリ生成
        const multiQueries = await extractIntentAndMakeQueries(text, searchLang, userLangCode, siteHost);

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let foundItems = [];
        let foundFrom = "";

        // 5) まず「今いるサイト」で全部試す
        if (siteHost) {
            for (const { q, lang: qlang } of multiQueries) {
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
                    // 次へ
                }
            }
        }

        // 6) サイトでは見つからなかった → サイト指定なしで全部試す
        if (foundItems.length === 0) {
            for (const { q, lang: qlang } of multiQueries) {
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
                    // 次へ
                }
            }
        }

        // 7) 返す
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
            // 全滅
            messages.push({
                role: "assistant",
                type: "text",
                content: uiStrings.notFound
            });
            if (siteHost && isEcomHost(siteHost)) {
                const q0 = multiQueries[0]?.q || text;
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title: userLangCode.startsWith("ja")
                                ? `${siteHost} で「${q0}」を検索`
                                : userLangCode.startsWith("zh")
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
            reply_lang: userLangCode,
            messages
        });

    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
