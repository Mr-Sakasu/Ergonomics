// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

// ---------- small utils ----------
async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
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

// ---------- 1. detect user input language (global) ----------
async function detectTextLangGlobal(text, fallback = "en") {
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
        {
          role: "system",
          content: `
You are a language detector.
Return ONLY JSON like {"lang_code":"es"}.
Support ANY language.
`
        },
        { role: "user", content: text }
      ]
    })
  });

  const j = await resp.json().catch(() => null);
  if (!resp.ok || !j) return fallback;
  try {
    const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return obj.lang_code || fallback;
  } catch {
    return fallback;
  }
}

// ---------- 2. UI strings ----------
async function getUiStrings(langCode) {
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

  // fallback: 英語
  return {
    found: "Here are the products I found.",
    other: "Not found on this site, but here are options from other sources.",
    notFound: "I couldn’t find it this time. Please add more keywords or constraints.",
    refine: "Tell me budget/brand/use case to refine."
  };
}

// ---------- 3. そのサイトでまず試すときの言語 ----------
function detectSiteSearchLang(host = "", userLang = "en") {
  const h = host.toLowerCase();
  if (h.includes("jd.com")) return "zh-CN";
  // ここを「ユーザー優先」にする
  return userLang;
}

// ---------- 4. LLMでクエリを作る（価格も取る） ----------
async function generateMultiQueries(userText, userLang, siteLang, siteHost = "") {
  const system = `
You are an e-commerce query generator.
From the user message, extract:
- short_query: core product/category (for example "keyboard", "mechanical keyboard", "laptop", "gaming laptop")
- price: if user mentioned price or budget, return {"amount":number,"currency":"USD|JPY|CNY|EUR|...","operator":"<=" or "~" or "="}
- queries: 2-4 concrete search queries
Return EXACT JSON:
{
  "short_query": "string",
  "price": {"amount": 100, "currency": "USD", "operator": "<="},
  "queries": [
    {"q": "string", "lang": "xx"},
    ...
  ]
}
Rules:
1. First query should be good for the given site language.
2. Second query should be in user's language.
3. Third query should be in English.
4. If the user said "around $100" or "under 100", set price.amount=100 and operator="<= ".
5. "latest" or "new" means: you may add "2025" or "new" but keep query SHORT.
`;
  const user = `
User message: ${userText}
User language: ${userLang}
Site language to target first: ${siteLang}
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
    // LLM死んだら最低限返す
    return {
      short_query: userText,
      price: null,
      queries: [
        { q: userText, lang: userLang },
        { q: "keyboard", lang: "en-US" }
      ]
    };
  }

  let obj = {};
  try {
    obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
  } catch {
    obj = {};
  }

  // 正規化
  const short_query = obj.short_query || userText;
  const price = obj.price && typeof obj.price.amount === "number"
    ? obj.price
    : null;
  const queries = Array.isArray(obj.queries) && obj.queries.length > 0
    ? obj.queries
    : [{ q: short_query, lang: userLang }];

  return { short_query, price, queries };
}

// ---------- 5. 価格つきクエリを増やす ----------
function expandQueriesWithPrice(baseQueries, shortQuery, priceObj) {
  if (!priceObj || !shortQuery) return baseQueries;

  const { amount, currency, operator } = priceObj;
  const cur = (currency || "USD").toUpperCase();
  const extras = [];

  // under / <=
  if (!operator || operator === "<=") {
    extras.push({ q: `${shortQuery} under ${amount} ${cur}`, lang: "en-US" });
    extras.push({ q: `${shortQuery} ${amount} ${cur}`, lang: "en-US" });
    if (cur === "USD") {
      extras.push({ q: `${shortQuery} $${amount}`, lang: "en-US" });
      extras.push({ q: `$${amount} ${shortQuery}`, lang: "en-US" });
    }
  } else if (operator === "~" || operator === "=") {
    extras.push({ q: `${shortQuery} ${amount} ${cur}`, lang: "en-US" });
    if (cur === "USD") extras.push({ q: `${shortQuery} around $${amount}`, lang: "en-US" });
  }

  // もともとのクエリ + 追加をマージ（重複除去）
  const seen = new Set();
  const out = [];
  for (const item of [...extras, ...baseQueries]) {
    if (!item || !item.q) continue;
    const key = item.q + "::" + (item.lang || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// ---------- main ----------
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { text = "", lang = "en-US", siteHost = "" } = await readJson(req);

    // 1) ユーザーの入力言語
    const userLang = await detectTextLangGlobal(text, lang);

    // 2) UI文言
    const ui = await getUiStrings(userLang);

    // 3) サイト向けの言語
    const siteLang = detectSiteSearchLang(siteHost, userLang);

    // 4) LLMでコア情報を取る（ここで short_query と price も取る）
    const qgen = await generateMultiQueries(text, userLang, siteLang, siteHost);

    // LLMが出したクエリに「価格つきバージョン」を足す
    const queries = expandQueriesWithPrice(qgen.queries || [], qgen.short_query, qgen.price);

    const SHOP_BASE = process.env.SHOP_BASE || "https://ergonomics-mu.vercel.app";

    let foundItems = [];
    let foundFrom = "";

    // 5) まず「今いるサイト」で全クエリを試す
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
        } catch {
          // 無視して次のクエリ
        }
      }
    }

    // 6) サイトで見つからなかったら → サイト指定なしで同じクエリを全部試す
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
        } catch {
          // 無視
        }
      }
    }

    // 7) それでもゼロなら、最後に「価格なし・コアだけ」でもう一回だけ試す
    if (foundItems.length === 0 && qgen.short_query && qgen.short_query !== text) {
      try {
        const r3 = await fetchWithTimeout(
          `${SHOP_BASE}/api/shop`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: qgen.short_query, siteHost: "", lang: userLang })
          },
          6000
        );
        const j3 = await r3.json().catch(() => null);
        if (j3?.ok && Array.isArray(j3.items) && j3.items.length > 0) {
          foundItems = j3.items;
          foundFrom = "global";
        }
      } catch {
        // ignore
      }
    }

    // 8) 応答を組み立てる
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
      // ほんとに何も出なかったとき
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
