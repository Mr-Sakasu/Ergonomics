// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || '{}'); } catch { return {}; }
}

function localeMsg(lang, key) {
    const ja = {
        refine: '価格帯・ブランド・用途を言ってくれればさらに絞れます。',
        here: 'このあたりが候補です。'
    };
    const zh = {
        refine: '说下预算/品牌/用途，我可以再筛选。',
        here: '这些是候选。'
    };
    const en = {
        refine: 'Tell me budget/brand/use case to refine.',
        here: 'Here are some options.'
    };
    const L = lang?.startsWith('ja') ? ja : lang?.startsWith('zh') ? zh : en;
    return L[key];
}

async function llmQueryGen(text, lang, siteHost) {
    const system = `
You are a shopping assistant.
- Detect user's language and ALWAYS respond in that language.
- Produce EXACT JSON (no extra text) with up to 3 "queries" for product search.
- Prefer site-specific queries if a siteHost looks like an e-commerce domain.
- Keep each query concise but specific (brand/model/size as needed).

Response schema:
{
  "reply_text": "string",
  "queries": ["string", "string", "string"]
}
`;
    const user = `User (${lang}): ${text}
Current site host: ${siteHost || '(none)'}
If siteHost seems e-commerce, generate queries focused on that site (e.g., include brand/model/keywords that would work well on that site).`;

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
    const j = await resp.json();
    if (!resp.ok) throw new Error(j?.error?.message || 'openai error');

    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || '{}'); } catch { }
    const queries = Array.isArray(obj.queries) ? obj.queries.slice(0, 3) : [text].filter(Boolean);
    return { reply_text: obj.reply_text, queries };
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const { text = '', lang = 'ja-JP', siteHost = '' } = await readJson(req);

        // 1) LLMで検索クエリを作成（site-aware）
        const qgen = await llmQueryGen(text, lang, siteHost);

        // 2) /api/shop にクエリを1〜3回投げて結合（重複は先頭優先）
        const itemsAll = [];
        // 自分自身の完全URLを作る（Vercel / ローカル両対応）
            const baseURL =
                  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
                  (req.headers.host && `https://${req.headers.host}`) ||
                  '';
            for (const q of qgen.queries) {
                  const r = await fetch(`${baseURL}/api/shop`, {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q, siteHost, lang })
            }).catch(() => null);

            const j = r ? await r.json().catch(() => null) : null;
            if (j?.ok && Array.isArray(j.items)) {
                for (const it of j.items) {
                    const key = (it.title || '') + (it.url || '');
                    if (!itemsAll.find(x => (x.title || '') + (x.url || '') === key)) itemsAll.push(it);
                    if (itemsAll.length >= 6) break;
                }
            }
            if (itemsAll.length >= 6) break;
        }

        // 3) 上位3つだけ返す
        const top = itemsAll.slice(0, 3);

        return res.status(200).json({
            ok: true,
            reply_lang: lang,
            messages: [
                { role: 'assistant', type: 'text', content: qgen.reply_text || localeMsg(lang, 'here') },
                { role: 'assistant', type: 'products', items: top },
                { role: 'assistant', type: 'text', content: localeMsg(lang, 'refine') }
            ]
        });
    } catch (e) {
        console.error('[chatbot] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
