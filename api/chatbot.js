// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// リクエストボディを読む
async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
        return JSON.parse(body || "{}");
    } catch {
        return {};
    }
}

// 言語ごとの定型文
function localeMsg(lang, key) {
    const ja = {
        found: "以下の商品が見つかりました。",
        notFound: "すみません、その条件では商品が見つかりませんでした。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。"
    };
    const zh = {
        found: "找到了以下商品。",
        notFound: "抱歉，没有找到符合条件的商品。",
        refine: "说下预算/品牌/用途，我可以再筛选。"
    };
    const en = {
        found: "Here are the products I found.",
        notFound: "Sorry, I couldn’t find matching products.",
        refine: "Tell me budget/brand/use case to refine."
    };
    const L = lang?.startsWith("ja")
        ? ja
        : lang?.startsWith("zh")
            ? zh
            : en;
    return L[key];
}

// ECサイトっぽいとき用の検索リンク
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
    const q = encodeURIComponent(query);
    const h = host.toLowerCase();
    if (h.includes("jd.com")) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes("amazon.")) return `https://${host}/s?k=${q}`;
    if (h.includes("rakuten.")) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

// ① 入力を検索用にきれいにするLLM
async function normalizeQuery(userText, lang, siteHost) {
    const system = `
You are a shopping query normalizer.
- Your job is to guess the user's buying intent from the text.
- Output EXACT JSON.
- Do NOT explain.
- If the user clearly wants a laptop/notebook computer, normalize to a laptop-related query.
Response schema:
{
  "query": "string",
  "lang_code": "ja" | "zh" | "en"
}
`;
    const user = `User (${lang}): ${userText}
Current site host: ${siteHost || "(none)"}.
Return the query in the same language as the user, suitable for e-commerce search.`;
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
    try {
        obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    } catch { }
    // 一応のフォールバック
    return {
        query: obj.query || userText,
        lang_code: obj.lang_code || (lang.startsWith("ja") ? "ja" : lang.startsWith("zh") ? "zh" : "en")
    };
}

// タイムアウト付きfetch
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

module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST")
        return res.status(405).json({ ok: false, error: "Method not allowed" });

    try {
        const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

        // 1) まずAIでキーワードを整理する（毎回必ず）
        const norm = await normalizeQuery(text, lang, siteHost);
        const replyLang =
            norm.lang_code === "ja"
                ? "ja-JP"
                : norm.lang_code === "zh"
                    ? "zh-CN"
                    : "en-US";

        // 2) 整理されたクエリで /api/shop を1回だけ叩く
        const SHOP_BASE =
            process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

        let items = [];
        try {
            const r = await fetchWithTimeout(
                `${SHOP_BASE}/api/shop`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        query: norm.query,
                        siteHost,
                        lang: replyLang
                    })
                },
                5000
            );
            const j = await r.json().catch(() => null);
            if (j?.ok && Array.isArray(j.items)) {
                items = j.items;
            }
        } catch {
            // 失敗したら items = [] のまま
        }

        const messages = [];

        if (items.length > 0) {
            // ヒットしたとき
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(replyLang, "found")
            });
            messages.push({
                role: "assistant",
                type: "products",
                items: items.slice(0, 6) // 見えるように6件まで
            });
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(replyLang, "refine")
            });
        } else {
            // ヒットしなかったとき
            messages.push({
                role: "assistant",
                type: "text",
                content: localeMsg(replyLang, "notFound")
            });

            // 今いるサイトがECなら、そのサイトの検索だけ出す
            if (siteHost && isEcomHost(siteHost)) {
                messages.push({
                    role: "assistant",
                    type: "products",
                    items: [
                        {
                            title:
                                replyLang.startsWith("ja")
                                    ? `${siteHost} で「${norm.query}」を検索`
                                    : replyLang.startsWith("zh")
                                        ? `在 ${siteHost} 上搜索「${norm.query}」`
                                        : `Search “${norm.query}” on ${siteHost}`,
                            url: buildSiteSearchUrl(siteHost, norm.query),
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
            reply_lang: replyLang,
            messages
        });
    } catch (e) {
        console.error("[chatbot] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
