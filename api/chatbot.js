// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';

function mkSearchLink(engine, query) {
    const q = encodeURIComponent(query);
    if (engine === 'bing') return `https://www.bing.com/search?q=${q}`;
    return `https://www.google.com/search?q=${q}`; // default google
}

function fallback(lang, text) {
    const msg =
        lang?.startsWith('ja') ? '了解です。まずは検索キーワードをもう少し具体化してください。'
            : lang?.startsWith('zh') ? '好的。请把需求再具体一些，比如预算/品牌/用途。'
                : 'Got it. Please add budget/brand/use case to refine.';
    return {
        ok: true,
        reply_lang: lang || 'en-US',
        messages: [
            { role: 'assistant', type: 'text', content: msg },
            {
                role: 'assistant',
                type: 'products',
                items: [
                    {
                        title: text || 'Your item',
                        url: mkSearchLink('google', (text || 'best value product')),
                        reason: lang?.startsWith('ja') ? 'まずは相場感を把握' :
                            lang?.startsWith('zh') ? '先了解价格区间' :
                                'Get a sense of price range'
                    }
                ]
            }
        ]
    };
}

async function callOpenAIRecommend(userText, lang) {
    const system = `
You are an AI shopping companion.
- Detect the user's language and ALWAYS respond in that language.
- DO NOT invent real product URLs.
- For each recommendation, output a short reason and a SEARCH QUERY string the user can click (Google/Bing).
- Keep text concise (<= 120 chars per item).
- Return strict JSON with this shape:
{
  "reply_text": "string, same language",
  "engine": "google" | "bing",
  "items": [
    { "title": "string", "reason": "string", "search_query": "string" },
    { "title": "string", "reason": "string", "search_query": "string" },
    { "title": "string", "reason": "string", "search_query": "string" }
  ]
}
`;
    const user = `User (${lang}): ${userText}`;

    const resp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ]
        })
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error?.message || 'openai error');

    let obj;
    try {
        obj = JSON.parse(json.choices?.[0]?.message?.content || '{}');
    } catch {
        obj = null;
    }
    return obj;
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { text = '', lang = 'ja-JP' } = JSON.parse(body || '{}');

        if (!OPENAI_API_KEY) {
            return res.status(200).json(fallback(lang, text));
        }

        const result = await callOpenAIRecommend(text, lang);
        if (!result || !Array.isArray(result.items)) {
            return res.status(200).json(fallback(lang, text));
        }

        const engine = result.engine === 'bing' ? 'bing' : 'google';
        const items = result.items.slice(0, 3).map(it => ({
            title: it.title,
            url: mkSearchLink(engine, it.search_query || it.title),
            reason: it.reason
        }));

        const replyText = result.reply_text ||
            (lang.startsWith('ja') ? 'このあたりが候補です。' :
                lang.startsWith('zh') ? '这些是可选项。' :
                    'Here are some options.');

        return res.status(200).json({
            ok: true,
            reply_lang: lang,
            messages: [
                { role: 'assistant', type: 'text', content: replyText },
                { role: 'assistant', type: 'products', items },
                {
                    role: 'assistant',
                    type: 'text',
                    content:
                        lang.startsWith('ja') ? '価格帯やブランド、用途を言えばさらに絞れます。' :
                            lang.startsWith('zh') ? '说预算/品牌/用途，我可以再筛选。' :
                                'Tell me budget/brand/use case to refine.'
                }
            ]
        });
    } catch (e) {
        console.error('[chatbot] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
