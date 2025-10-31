// api/lang-detect.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com";

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { text = "" } = await readJson(req);
    if (!text.trim()) {
        return res.status(200).json({ ok: true, lang_code: "en" });
    }

    try {
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
Support ANY language: ja, zh, en, ko, es, pt, fr, de, ru, th, vi, id, ar, ...
`
                    },
                    { role: "user", content: text }
                ]
            })
        });

        const j = await resp.json();
        if (!resp.ok) {
            return res.status(200).json({ ok: true, lang_code: "en" });
        }
        let obj = {};
        try { obj = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { }
        return res.status(200).json({
            ok: true,
            lang_code: obj.lang_code || "en"
        });
    } catch (e) {
        console.error("[lang-detect] error", e);
        return res.status(200).json({ ok: true, lang_code: "en" });
    }
};
