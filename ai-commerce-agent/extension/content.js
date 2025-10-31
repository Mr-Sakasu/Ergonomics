// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

// ★変更ポイントここ
// host と userLang の両方を見て「このサイト向けのクエリは何語にすべきか」を決める
function detectSiteLang(host = "", userLang = "en-US") {
  const h = host.toLowerCase();

  // JD は中国語に寄せるのが一番ヒットするので固定
  if (h.includes("jd.com")) return "zh-CN";

  // 日本ドメインでも、ユーザーが英語/中国語で話してたらそのまま使う
  if (
    h.includes("amazon.co.jp") ||
    h.includes("rakuten.co.jp") ||
    h.includes("rakuten.jp") ||
    h.includes("shopping.yahoo.co.jp") ||
    h.includes("yahoo.co.jp")
  ) {
    // ユーザーが日本語なら日本語、そうじゃなければユーザーの言語を優先
    if (userLang.startsWith("ja")) return "ja-JP";
    if (userLang.startsWith("zh")) return "zh-CN";
    return "en-US";
  }

  // それ以外は「サイトとしての指定なし」→ normalize側でユーザー言語を使う
  return null;
}

function localeMsg(lang, key) {
  const ja = {
    found: "以下が見つかりました。",
    notFound: "すみません、その条件では商品が見つかりませんでした。",
    refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。",
    otherSite: "このサイトでは見つかりませんでしたが、他のECから候補を表示します。"
  };
  const zh = {
    found: "找到了以下商品。",
    notFound: "抱歉，没有找到符合条件的商品。",
    refine: "说下预算/品牌/用途，我可以再筛选。",
    otherSite: "当前站点没找到，我从其他站点拉了一些候选。"
  };
  const en = {
    found: "Here are the products I found.",
    notFound: "Sorry, I couldn’t find matching products.",
    refine: "Tell me budget/brand/use case to refine.",
    otherSite: "Not found on this site, but here are results from other sources."
  };
  const L = lang?.startsWith("ja") ? ja : lang?.startsWith("zh") ? zh : en;
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

// 入力をサイト向けに正規化する
async function normalizeQuery(userText, userLang, siteHost) {
  // ★ここで userLang を渡すようにする
  const siteLang = detectSiteLang(siteHost, userLang); // ←変更後

  const system = `
You are an e-commerce query normalizer.
Goal:
- Infer what the user wants to buy.
- Output EXACT JSON only.
- If "site_lang" is given, generate the query in that language.
- If site_lang is null, use user's language.
Response schema:
{
  "query": "string",
  "lang_code": "ja" | "zh" | "en"
}
`;
  const user = `
User text (${userLang}): ${userText}
Site host: ${siteHost || "(none)"}
Site language (if any): ${siteLang || "(none)"}
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

  // lang_code がなければ、siteLang > userLang の順で決める
  const picked =
    obj.lang_code ||
    (siteLang
      ? siteLang.startsWith("ja")
        ? "ja"
        : siteLang.startsWith("zh")
          ? "zh"
          : "en"
      : userLang.startsWith("ja")
        ? "ja"
        : userLang.startsWith("zh")
          ? "zh"
          : "en");

  return {
    query: obj.query || userText,
    lang_code: picked
  };
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

    // 1) ユーザー入力をサイト向けに正規化
    const norm = await normalizeQuery(text, lang, siteHost);

    const replyLang =
      norm.lang_code === "ja" ? "ja-JP" :
        norm.lang_code === "zh" ? "zh-CN" :
          "en-US";

    const SHOP_BASE =
      process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

    // 2) まず「いまのサイト」で検索
    let primaryItems = [];
    if (siteHost) {
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
          5500
        );
        const j = await r.json().catch(() => null);
        if (j?.ok && Array.isArray(j.items)) {
          primaryItems = j.items;
        }
      } catch { }
    }

    // 3) いまのサイトで0件なら、サイト指定なしで再検索
    let globalItems = [];
    if (primaryItems.length === 0) {
      try {
        const r2 = await fetchWithTimeout(
          `${SHOP_BASE}/api/shop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: norm.query,
              siteHost: "",
              lang: replyLang
            })
          },
          5500
        );
        const j2 = await r2.json().catch(() => null);
        if (j2?.ok && Array.isArray(j2.items)) {
          globalItems = j2.items;
        }
      } catch { }
    }

    const messages = [];

    if (primaryItems.length > 0) {
      messages.push({
        role: "assistant",
        type: "text",
        content: localeMsg(replyLang, "found")
      });
      messages.push({
        role: "assistant",
        type: "products",
        items: primaryItems.slice(0, 6)
      });
      messages.push({
        role: "assistant",
        type: "text",
        content: localeMsg(replyLang, "refine")
      });
    } else if (globalItems.length > 0) {
      messages.push({
        role: "assistant",
        type: "text",
        content: localeMsg(replyLang, "otherSite")
      });
      messages.push({
        role: "assistant",
        type: "products",
        items: globalItems.slice(0, 6)
      });
      messages.push({
        role: "assistant",
        type: "text",
        content: localeMsg(replyLang, "refine")
      });
    } else {
      messages.push({
        role: "assistant",
        type: "text",
        content: localeMsg(replyLang, "notFound")
      });
      if (siteHost && isEcomHost(siteHost)) {
        messages.push({
          role: "assistant",
          type: "products",
          items: [
            {
              title: replyLang.startsWith("ja")
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
