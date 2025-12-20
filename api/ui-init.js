// api/ui-init.js (NEW FILE)
//
// Returns localized UI strings for the SidePanel (welcome message + input placeholder).
// The extension calls this once at startup via background (AIC_UI_INIT).

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 12000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), ms);
    try { return await fetch(url, { ...opt, signal: ctrl.signal }); }
    finally { clearTimeout(id); }
}

function normalizeLangHint(langHint = "") {
    const s = String(langHint || "").trim();
    if (!s) return "";
    return s.replace("_", "-");
}
function langBase(lang = "") {
    const s = String(lang || "").toLowerCase();
    return s.split("-")[0] || "en";
}
function toBcp47(base = "en") {
    const b = String(base).toLowerCase();
    if (b.startsWith("ja")) return "ja-JP";
    if (b.startsWith("zh")) return "zh-CN";
    if (b.startsWith("ko")) return "ko-KR";
    return "en-US";
}

async function openaiJson(messages, timeoutMs = 12000) {
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
                temperature: 0.2,
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
        const body = await readJson(req);
        const hint = normalizeLangHint(body.lang || "");
        const userLang = hint || toBcp47(langBase(hint || "en"));

        // If OpenAI key missing, fallback minimal strings
        if (!OPENAI_API_KEY) {
            const b = langBase(userLang);
            const fallback =
                b === "ja"
                    ? {
                        welcome: "欲しいものを入力してください（JDで検索します）。例：「ラーメン」「軽いノートPC 10万円」「iPhone 15 ケース」",
                        placeholder: "例）ラーメン / 軽い ノートPC 10万円 / iPhone 15 ケース",
                    }
                    : b === "zh"
                        ? {
                            welcome: "请输入你想买的东西（我会在京东搜索）。例如：拉面、轻薄笔记本电脑、iPhone 15 手机壳。",
                            placeholder: "例如：拉面 / 轻薄 笔记本电脑 / iPhone 15 手机壳",
                        }
                        : {
                            welcome:
                                'Tell me what you want (I will search on JD). e.g. "ramen", "light laptop under 4000 CNY", "iPhone 15 case".',
                            placeholder: 'e.g. ramen / light laptop / iPhone 15 case',
                        };

            return res.status(200).json({ ok: true, lang: userLang, ...fallback, ui_version: 1 });
        }

        const system = `
You generate SHORT UI copy for an e-commerce assistant side panel.

Return JSON with EXACT keys:
{
  "welcome": "...",      // 1-2 short sentences
  "placeholder": "..."   // a short placeholder with examples
}

Rules:
- Write in the user's language exactly: ${userLang}.
- Mention that it searches JD (Jingdong / 京东) but do NOT mention any internal mode text like "(JD固定 / Modeなし)".
- Keep it short, friendly, and actionable.
- Provide examples like: ramen, lightweight laptop, iPhone case.
`;

        const obj = await openaiJson(
            [
                { role: "system", content: system.trim() },
                { role: "user", content: "Generate UI strings for the side panel." },
            ],
            12000
        );

        const welcome = String(obj?.welcome || "").trim();
        const placeholder = String(obj?.placeholder || "").trim();

        const out = {
            ok: true,
            lang: userLang,
            welcome: welcome || "Tell me what you want (JD search).",
            placeholder: placeholder || 'e.g. ramen / light laptop / iPhone 15 case',
            ui_version: 1
        };

        return res.status(200).json(out);

    } catch (e) {
        console.error("[ui-init] error", e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
