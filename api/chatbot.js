// ergonomics/api/chatbot.js

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE =
    process.env.OPENAI_API_BASE || 'https://api.openai.com';

function fallback(lang, items) {
    const hi =
        lang?.startsWith('ja')
            ? '了解しました。JDでそれっぽいものを探しました。'
            : lang?.startsWith('zh')
                ? '好的，我在京东上找了一下。'
                : 'Got it. I found some JD candidates.';
    const ask =
        lang?.startsWith('ja')
            ? '予算やブランド、京東自営の希望があれば続けてください。'
            : lang?.startsWith('zh')
                ? '如果有预算、品牌或者是否自营的要求，可以说一下。'
                : 'Tell me budget/brand/self-operated and I can refine.';
    return {
        ok: true,
        reply_lang: lang || 'en-US',
        messages: [
            { role: 'assistant', type: 'text', content: hi },
            { role: 'assistant', type: 'products', items },
            { role: 'assistant', type: 'text', content: ask }
        ]
    };
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const { text = '', lang = 'ja-JP' } = req.body || {};

    // モックJD
    const items = [1, 2, 3].map(i => ({
        title: `${text || '商品'} (JD mock ${i})`,
        price: 100 + i * 10,
        url: '',
        reasons: []
    }));

    // OpenAIなければモックでOK
    if (!OPENAI_API_KEY) {
        return res.status(200).json(fallback(lang, items));
    }

    try {
        const r = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                messages: [
                    {
                        role: 'system',
                        content:
                            'You are an AI commerce assistant. Detect user language and reply in the same language. Show 2-3 short suggestions.'
                    },
                    {
                        role: 'user',
                        content: `User message (${lang}): ${text}`
                    }
                ]
            })
        });

        const j = await r.json();

        const content =
            j?.choices?.[0]?.message?.content ||
            (lang.startsWith('ja')
                ? 'このあたりが良さそうです。'
                : lang.startsWith('zh')
                    ? '这几款你可以看看。'
                    : 'Here are some options.');

        return res.status(200).json({
            ok: true,
            reply_lang: lang,
            messages: [
                { role: 'assistant', type: 'text', content },
                { role: 'assistant', type: 'products', items },
                {
                    role: 'assistant',
                    type: 'text',
                    content:
                        lang.startsWith('ja')
                            ? '価格やブランドでもう少し絞れます。'
                            : lang.startsWith('zh')
                                ? '你也可以说预算/品牌，我再筛。'
                                : 'You can narrow by price/brand.'
                }
            ]
        });
    } catch (e) {
        console.error('[vercel] openai error', e);
        return res.status(200).json(fallback(lang, items));
    }
};
