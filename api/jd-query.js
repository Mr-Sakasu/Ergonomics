// api/jd-query.js
// JD検索用: ユーザー入力を「JD検索バーに貼り付けるキーワード」に整形する（GPT）
// 返却: { ok: true, queries: ["...","..."] }
//
// NOTE:
// - ここでは商品検索だけが目的なので、長文や条件文は短いキーワードに圧縮する
// - global.jd.com の場合は「英語 + 中国語」を混ぜて候補を出す（どちらが当たるかわからないため）

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { text = "", lang = "en", siteHost = "" } = await readJson(req);
    const userText = String(text || "").trim();
    if (!userText) return res.status(200).json({ ok: true, queries: [] });

    const host = String(siteHost || "").toLowerCase();
    const isGlobal = host === "global.jd.com" || host.endsWith(".global.jd.com");

    // OpenAIが未設定ならフォールバック
    if (!OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        queries: [userText],
        note: "OPENAI_API_KEY is not set; returned raw text.",
      });
    }

    const system = `
You are a keyword optimizer for JD.com search bar.
Return ONLY JSON:
{"queries":["...","...","..."]}

Requirements:
- Convert the user request into 3 to 6 SHORT search queries suitable for pasting into JD's search input.
- Keep product type/category + essential attributes (model, size, color, material, key feature).
- If user mentions budget/price range, REMOVE it from the query (JD search box doesn't reliably parse it).
- Do NOT add brands the user didn't mention.
- No explanations, no extra keys.
- If current site is global.jd.com, include BOTH Chinese and English variants among the candidates.
- Otherwise (domestic JD), prefer simplified Chinese first.
`;

    const user = `
User input: ${userText}
User lang hint: ${lang}
Current host: ${siteHost}
Mode: ${isGlobal ? "global.jd.com" : "domestic/other.jd.com"}
Examples of good outputs:
- "拉面 方便面"
- "Nissin ramen noodles"
- "无线耳机 降噪"
- "iPhone 15 128GB"
`;

    const resp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system.trim() },
          { role: "user", content: user.trim() },
        ],
      }),
    });

    const j = await resp.json().catch(() => null);

    if (!resp.ok || !j) {
      return res.status(200).json({ ok: true, queries: [userText] });
    }

    let queries = [];
    try {
      const obj = JSON.parse(j.choices?.[0]?.message?.content || "{}");
      if (Array.isArray(obj.queries)) queries = obj.queries;
    } catch {
      queries = [];
    }

    // 正規化 + 重複排除
    const seen = new Set();
    const out = [];
    for (const q of queries) {
      const s = String(q || "").replace(/\s+/g, " ").trim();
      if (!s) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= 6) break;
    }
    if (out.length === 0) out.push(userText);

    return res.status(200).json({ ok: true, queries: out });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e) });
  }
};
