// api/lang-detect.js (REPLACE WHOLE FILE)
//
// POST { text: "...", defaultLang: "en-US" }
// -> { ok: true, lang: "pt-BR" } etc.
//
// General solution:
// - Always use OpenAI for language detection (supports many languages).
// - Validate BCP-47 tag; fallback to defaultLang if invalid.
// - If OpenAI API key missing, return defaultLang.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 9000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort("timeout"), ms);
  try { return await fetch(url, { ...opt, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}

function normalizeLangTag(tag = "") {
  return String(tag || "").trim();
}

// Accept "xx" or "xx-YY" (common practical subset for UI)
// You can relax this if you want scripts like zh-Hant.
function isValidLangTag(tag) {
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(tag);
}

function defaultRegionize(lang, fallback = "en-US") {
  const base = String(lang || "").toLowerCase();
  const map = {
    en: "en-US",
    ja: "ja-JP",
    zh: "zh-CN",
    ko: "ko-KR",
    pt: "pt-BR",
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    it: "it-IT",
    nl: "nl-NL",
    pl: "pl-PL",
    sv: "sv-SE",
    ru: "ru-RU",
    uk: "uk-UA",
    th: "th-TH",
    vi: "vi-VN",
    id: "id-ID",
    ms: "ms-MY",
    fil: "fil-PH",
    hi: "hi-IN",
    ar: "ar-SA",
    tr: "tr-TR",
  };
  return map[base] || fallback;
}

async function openaiJson(messages, timeoutMs = 9000) {
  if (!OPENAI_API_KEY) return null;

  const r = await fetchWithTimeout(
    `${OPENAI_API_BASE}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages,
      }),
    },
    timeoutMs
  ).catch(() => null);

  if (!r) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return null;

  try { return JSON.parse(j.choices?.[0]?.message?.content || "{}"); }
  catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { text = "", defaultLang = "en-US" } = await readJson(req);
    const fallback = normalizeLangTag(defaultLang) || "en-US";

    if (!OPENAI_API_KEY) {
      return res.status(200).json({ ok: true, lang: fallback, note: "no_api_key" });
    }

    const system = `
Detect the primary language of the given text and return a BCP-47 language tag.

Return JSON with EXACT keys:
{ "lang": "..." }

Rules:
- Output a short BCP-47 tag like "en-US", "ja-JP", "pt-BR", "ru-RU", "th-TH", "id-ID".
- If you are unsure, return "${fallback}".
- Do NOT output explanations.
`;

    const user = `TEXT:\n${String(text || "").slice(0, 1200)}`;

    const obj = await openaiJson(
      [{ role: "system", content: system.trim() }, { role: "user", content: user }],
      9000
    );

    let lang = normalizeLangTag(obj?.lang || "");
    // Normalize common cases like "ja" -> "ja-JP"
    if (/^[a-z]{2,3}$/.test(lang)) lang = defaultRegionize(lang, fallback);

    if (!isValidLangTag(lang)) lang = fallback;

    return res.status(200).json({ ok: true, lang });
  } catch (e) {
    return res.status(200).json({ ok: true, lang: "en-US", error: String(e) });
  }
};
