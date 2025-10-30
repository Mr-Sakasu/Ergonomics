// api/chatbot.js
import crypto from 'crypto';

const JD_APP_KEY = process.env.JD_APP_KEY || '';
const JD_APP_SECRET = process.env.JD_APP_SECRET || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';

function buildMultilingualFallback(lang, items) {
    const hi =
        lang.startsWith('zh')
            ? '好的，我在京东上找了一下。'
            : lang.startsWith('ja')
                ? '了解しました。JDでそれっぽいものを探しました。'
                : 'Got it. I found some JD candidates.';
    const ask =
        lang.startsWith('zh')
            ? '如果你有预算、品牌或者是否自营的要求，可以说一下。'
            : lang.startsWith('ja')
                ? '予算やブランド、京東自営の希望があれば続けてください。'
                : 'Tell me budget or brand, or if you need JD self-operated.';
    return {
        ok: true,
        reply_lang: lang,
        messages: [
            { role: 'assistant', type: 'text', content: hi },
            { role: 'assistant', type: 'products', items },
            { role: 'assistant', type: 'text', content: ask }
        ]
    };
}

// Vercelでは同一ファイル内で使えばいいので /api/jd-search をHTTPで叩かずに関数にする
async function searchJD(keyword) {
    // 実キーがないときはモック
    if (!JD_APP_KEY || !JD_APP_SECRET) {
        return [1, 2, 3].map(i => ({
            title: `${keyword || '商品'} (JD mock ${i})`,
            price: 100 + i * 10,
            url: '',
            reasons: []
        }));
    }
    // 実際にJingDongに飛ばしたい場合はここに署名コードを入れる（ローカルと同じ）
    // ひとまずモックにしておく
    return [1, 2, 3].map(i => ({
        title: `${keyword || '商品'} (JD mock ${i})`,
        price: 100 + i * 10,
        url: '',
        reasons: []
    }));
}

export default async function handler(req, res) {
    // CORS（拡張から来るので緩める）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { text = '', lang = 'ja-JP', provider = 'jd' } = req.body || {};

    // 1. まずJD候補をとる（今は関数でモック）
    const jdItems = await searchJD(text);

    // 2. OpenAIキーがないときはフォールバック
    if (!OPENAI_API_KEY) {
        return res.status(200).json(buildMultilingualFallback(lang, jdItems));
    }

    // 3. LLMに投げる
    const productsText = jdItems
        .map(
            (it, idx) =>
                `${idx + 1}. ${it.title} - ${it.price ? `¥${it.price}` : '価格不明'} ${it.url ? `(${it.url})` : ''
                }`
        )
        .join('\n');

    const systemPrompt = `
You are an AI commerce assistant.
- Detect the user's language from the message.
- ALWAYS reply in the SAME language.
- Show 2-3 recommendations from the list I give you.
- Keep it concise (max 120 chars per bullet).
`;

    const userPrompt = `
User message (${lang}): ${text}

Here are JD candidates:
${productsText}

Please recommend 2–3 items from above, and tell the user what to check (price, shipping, warranty) in the SAME language.
`;

    try {
        const oaResp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        const oaJson = await oaResp.json();

        const assistantText =
            oaJson?.choices?.[0]?.message?.content ||
            (lang.startsWith('ja')
                ? '了解です。以下が候補です。'
                : lang.startsWith('zh')
                    ? '好的，下面是几款候选。'
                    : 'Here are some candidates.');

        return res.status(200).json({
            ok: true,
            reply_lang: lang,
            messages: [
                { role: 'assistant', type: 'text', content: assistantText },
                { role: 'assistant', type: 'products', items: jdItems },
                {
                    role: 'assistant',
                    type: 'text',
                    content:
                        lang.startsWith('ja')
                            ? '価格やブランドでもう少し絞り込めます。'
                            : lang.startsWith('zh')
                                ? '你也可以说预算/品牌/是否自营，我再筛一下。'
                                : 'You can give budget/brand to narrow down.'
                }
            ]
        });
    } catch (e) {
        console.error('[vercel] openai error', e);
        return res.status(200).json(buildMultilingualFallback(lang, jdItems));
    }
}
