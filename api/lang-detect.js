// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// ========== small utils ==========
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 6000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opt, signal: ctrl.signal });
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

// ========== ★ あなたの /api/lang-detect を使う ==========
async function detectTextLangViaApi(text, req) {
    // 同じ Vercel / 同じホストで動いている想定
    const base =
        (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
        (req?.headers?.host && `https://${req.headers.host}`) ||
        "";
    try {
        const r = await fetch(`${base}/api/lang-detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const j = await r.json();
        if (j?.ok && j.lang_code) return j.lang_code;
    } catch (e) {
        console.error("[chatbot] lang-detect api failed", e);
    }
    return "en";
}

// ========== 2. UI strings ==========
function getUiStringsSync(langCode) {
    if (langCode.startsWith("ja")) {
        return {
            found: "以下が見つかりました。",
            other: "このサイトでは見つかりませんでしたが、他のところから候補を出します。",
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
    // fallback
    return {
        found: "Here are the products I found.",
        other: "Not found on this site, but here are options from other sources.",
        notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
        refine: "Tell me budget/brand/use case to refine."
    };
}

// ========== 3. site-search-lang ==========
function detectSiteSearchLang(host = "", userLang = "en") {
    const h = host.toLowerCase();
    if (h.includes("jd.com")) return "zh-CN";
    // ★ ここを “ユーザー優先” にする
    return userLang;
}

// ========== 4. LLMでコア＋価格を作る ==========
async function generateMultiQueries(userText, userLang, siteLang, siteHost = "") {
    const system = `
You are an e-commerce query generator.
Extract short_query, price and a few queries.
Return EXACT JSON:
{
  "short_query": "string",
  "price": {"amount": 100, "currency": "USD", "operator": "<="},
  "queries": [
    {"q": "string", "lang": "xx"}
  ]
}
`;
    const user = `
User message: ${userText}
User language: ${userLang}
Site language: ${siteLang}
Site host: ${siteHost || "(none)"}
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
    const j = await resp.json().catch(() => null);
    if (!resp.ok || !j) {
        return {
            short_query: userText,
            price: null,
            queries: [{ q: userText, lang: userLang }]
        };
    }
    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
    return {
        short_query: obj.short_query || userText,
        price: obj.price || null,
        queries: Array.isArray(obj.queries) && obj.queries.length
            ? obj.queries
            : [{ q: obj.short_query || userText, lang: userLang }]
    };
}

// ========== ★ 言語依存で価格つきクエリを作る ==========
function priceQueryVariants(shortQuery, amount, cur, operator, langCode) {
    const lang = (langCode || "en").toLowerCase();
    const res = [];

    // 日本語
    if (lang.startsWith("ja")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} ${amount}円以下`, lang: "ja-JP" });
            res.push({ q: `${shortQuery} ${amount}円以内`, lang: "ja-JP" });
        } else {
            res.push({ q: `${shortQuery} 約${amount}円`, lang: "ja-JP" });
        }
        return res;
    }

    // 中国語
    if (lang.startsWith("zh")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} ${amount}元以下`, lang: "zh-CN" });
            res.push({ q: `${shortQuery} 不超过${amount}元`, lang: "zh-CN" });
        } else {
            res.push({ q: `${shortQuery} 大约${amount}元`, lang: "zh-CN" });
        }
        return res;
    }

    // 韓国語
    if (lang.startsWith("ko")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} ${amount}원 이하`, lang: "ko-KR" });
        } else {
            res.push({ q: `${shortQuery} 약 ${amount}원`, lang: "ko-KR" });
        }
        return res;
    }

    // スペイン語
    if (lang.startsWith("es")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} menos de ${amount} ${cur}`, lang: "es" });
            res.push({ q: `${shortQuery} hasta ${amount} ${cur}`, lang: "es" });
        } else {
            res.push({ q: `${shortQuery} alrededor de ${amount} ${cur}`, lang: "es" });
        }
        return res;
    }

    // ポルトガル語
    if (lang.startsWith("pt")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} até ${amount} ${cur}`, lang: "pt" });
        } else {
            res.push({ q: `${shortQuery} cerca de ${amount} ${cur}`, lang: "pt" });
        }
        return res;
    }

    // ロシア語
    if (lang.startsWith("ru")) {
        if (!operator || operator === "<=") {
            res.push({ q: `${shortQuery} до ${amount} ${cur}`, lang: "ru" });
        } else {
            res.push({ q: `${shortQuery} около ${amount} ${cur}`, lang: "ru" });
        }
        return res;
    }

    // デフォルトは英語
    if (!operator || operator === "<=") {
        res.push({ q: `${shortQuery} under ${amount} ${cur}`, lang: "en-US" });
        res.push({ q: `${shortQuery} ${amount} ${cur}`, lang: "en-US" });
        if (cur === "USD") {
            res.push({ q: `${shortQuery} $${amount}`, lang: "en-US" });
            res.push({ q: `$${amount} ${shortQuery}`, lang: "en-US" });
        }
    } else {
        res.push({ q: `${shortQuery} ${amount} ${cur}`, lang: "en-US" });
        if (cur === "USD") {
            res.push({ q: `${shortQuery} around $${amount}`, lang: "en-US" });
        }
    }
    return res;
}

function expandQueriesWithPrice(baseQueries, shortQuery, priceObj, siteLang, userLang) {
    if (!priceObj || !shortQuery) return baseQueries;
    const { amount, currency, operator } = priceObj;
    const cur = (currency || "USD").toUpperCase();

    const extras = [];

    // ① 今いるサイトの言語で
    extras.push(...priceQueryVariants(shortQuery, amount, cur, operator, siteLang));

    // ② ユーザーの言語が違えばユーザーの言語でも
    if (!userLang.toLowerCase().startsWith(siteLang.toLowerCase().slice(0, 2))) {
        extras.push(...priceQueryVariants(shortQuery, amount, cur, operator, userLang));
    }

    // ③ 最後に英語を保険で
    extras.push(...priceQueryVariants(shortQuery, amount, cur, operator, "en-US"));

    // マージ
    const seen = new Set();
    const out = [];
    for (const it of [...extras, ...baseQueries]) {
        if (!it || !it.q) continue;
        const key = it.q + "::" + (it.lang || "");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
        if (out.length >= 14) break;
    }
    return out;
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

        // ★ 1) ここであなたの lang-detect を使う
        const userLang = await detectTextLangViaApi(text, req) || lang;

        const ui = getUiStringsSync(userLang);

        const siteLang = detectSiteSearchLang(siteHost, userLang);

        // 2) LLMでshort_queryとpriceとベースクエリをとる
        const qgen = await generateMultiQueries(text, userLang, siteLang, siteHost);

        // 3) 価格つきクエリをユーザー＆サイトの言語で増やす
        const queries = expandQueriesWithPrice(
            qgen.queries || [],
            qgen.short_query,
            qgen.price,
            siteLang,
            userLang
        );

        const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let foundItems = [];
        let foundFrom = "";

        // 4) まず今のサイトで全部試す
        if (siteHost) {
            for (const { q, lang: qlang } of queries) {
                try {
                    const r = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost, lang: qlang || siteLang })
                        },
                        6000
                    );
                    const j = await r.json().catch(() => null);
                    if (j?.ok && Array.isArray(j.items) && j.items.length > 0) {
                        foundItems = j.items;
                        foundFrom = "site";
                        break;
                    }
                } catch { }
            }
        }

        // 5) サイトでゼロならグローバル
        if (foundItems.length === 0) {
            for (const { q, lang: qlang } of queries) {
                try {
                    const r2 = await fetchWithTimeout(
                        `${SHOP_BASE}/api/shop`,
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ query: q, siteHost: "", lang: qlang || userLang })
                        },
                        6000
                    );
                    const j2 = await r2.json().catch(() => null);
                    if (j2?.ok && Array.isArray(j2.items) && j2.items.length > 0) {
                        foundItems = j2.items;
                        foundFrom = "global";
                        break;
                    }
                } catch { }
            }
        }

        // 6) それでもダメなら「サイトで検索して」カード＋notFound
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
            messages.push({
                role: "assistant",
                type: "text",
                content: ui.notFound
            });
            if (siteHost && isEcomHost(siteHost)) {
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title: userLang.startsWith("ja")
                                ? `${siteHost} で「${qgen.short_query || text}」を検索`
                                : userLang.startsWith("zh")
                                    ? `在 ${siteHost} 上搜索「${qgen.short_query || text}」`
                                    : `Search “${qgen.short_query || text}” on ${siteHost}`,
                            url: buildSiteSearchUrl(siteHost, qgen.short_query || text),
                            price: "",
                            image: "",
                            source: siteHost
                        }
                    ]
                });
            }
            messages.push({
                role: "assistant",
                type: "text",
                content: ui.refine
            });
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
