// api/stt.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        // ブラウザから multipart/form-data で audio を受ける
        const formData = await req.formData();              // Vercel Edge/Node16+ で利用可
        const file = formData.get('audio');                 // Blob (webm/ogg/m4a/wav など)
        if (!file) return res.status(400).json({ ok: false, error: 'no audio' });

        const oaForm = new FormData();
        oaForm.set('file', file, 'voice.webm');
        oaForm.set('model', 'whisper-1');
        oaForm.set('response_format', 'verbose_json');      // language を含む

        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: oaForm
        });
        const j = await r.json();
        // j.text, j.language が得られる
        return res.status(200).json({ ok: true, text: j.text || '', lang: j.language || 'auto' });
    } catch (e) {
        console.error('[stt] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
