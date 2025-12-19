// api/lang-detect.js
// Lightweight language detection (no external calls).

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

function detectLangHeuristic(text = "") {
  const s = String(text);
  if (/[ぁ-んァ-ン]/.test(s)) return "ja";
  if (/[\uac00-\ud7af]/.test(s)) return "ko";
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(s)) return "zh";
  if (/[\u0E00-\u0E7F]/.test(s)) return "th";
  if (/[\u0600-\u06FF]/.test(s)) return "ar";
  if (/[\u0400-\u04FF]/.test(s)) return "ru";
  return "en";
}

function toBcp47(base = "en") {
  const b = String(base).toLowerCase();
  if (b.startsWith("ja")) return "ja-JP";
  if (b.startsWith("zh")) return "zh-CN";
  if (b.startsWith("ko")) return "ko-KR";
  if (b.startsWith("th")) return "th-TH";
  if (b.startsWith("ar")) return "ar";
  if (b.startsWith("ru")) return "ru";
  return "en-US";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { text = "", hint = "" } = await readJson(req);
  const base = (hint && String(hint).split(/[-_]/)[0].toLowerCase()) || detectLangHeuristic(text);

  return res.status(200).json({
    ok: true,
    lang_code: toBcp47(base),
    lang_base: base
  });
};
