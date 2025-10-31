// api/stt.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || '{}'); } catch { return {}; }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const { audioBase64, mimeType = 'audio/webm' } = await readJson(req);
        if (!audioBase64) return res.status(400).json({ ok: false, error: 'no audioBase64' });

        // base64 → Buffer → Blob（Node18+）
        const buffer = Buffer.from(audioBase64, 'base64');
        const file = new Blob([buffer], { type: mimeType });

        const form = new FormData();
        form.append('file', file, 'voice.webm');
        form.append('model', 'whisper-1');
        form.append('response_format', 'verbose_json'); // languageを含む

        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: form
        });

        const j = await r.json();
        // 失敗時の素通し
        if (!r.ok) return res.status(200).json({ ok: false, error: j?.error?.message || 'whisper error' });

        // j.text, j.language など
        return res.status(200).json({ ok: true, text: j.text || '', lang: j.language || 'auto' });

    } catch (e) {
        console.error('[stt] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
