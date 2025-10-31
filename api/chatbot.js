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
        here: 'このあたりが候補です。',
        notFound: 'すみません、その条件では商品が見つかりませんでした。'
    };
    const zh = {
        refine: '说下预算/品牌/用途，我可以再筛选。',
        here: '这些是候选。',
        notFound: '抱歉，没有找到符合条件的商品。'
    };
    const en = {
        refine: 'Tell me budget/brand/use case to refine.',
        here: 'Here are some options.',
        notFound: 'Sorry, I could not find matching products.'
    };
    const L = lang?.startsWith('ja') ? ja : lang?.startsWith('zh') ? zh : en;
    return L[key];
}

function isEcomHost(host = '') {
    const h = host.toLowerCase();
    return (
        h.includes('jd.com') ||
        h.includes('amazon.') ||
        h.includes('rakuten.') ||
        h.includes('yahoo.co.jp') ||
        h.includes('taobao.') ||
        h.includes('tmall.')
    );
}

function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes('jd.com')) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes('amazon.')) return `https://${host}/s?k=${q}`;
    if (h.includes('rakuten.')) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

async function llmQueryGen(text, lang, siteHost) {
    const system = `
You are a shopping assistant.
- Detect user's language and ALWAYS respond in that language.
- Produce EXACT JSON (no extra text) with up to 3 "queries" for product search.
- Also output "lang_code" with best guess for the user's message (ja / zh / en).
- Prefer site-specific queries if a siteHost looks like an e-commerce domain.
- Keep each query concise but specific.

Response schema:
{
  "reply_text": "string",
  "lang_code": "ja" | "zh" | "en",
  "queries": ["string", "string", "string"]
}
`;
    const user = `User (${lang}): ${text}
Current site host: ${siteHost || '(none)'}`;

    // ---- ここで落ちても上で拾うのでOKにする
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
    return {
        reply_text: obj.reply_text,
        queries,
        lang_code: obj.lang_code
    };
}

// ---- fetch にタイムアウトをつける小さいユーティリティ
async function fetchWithTimeout(url, opt = {}, ms = 5000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        const r = await fetch(url, { ...opt, signal: ctrl.signal });
        return r;
    } finally {
        clearTimeout(id);
    }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    try {
        const { text = '', lang = 'en-US', siteHost = '' } = await readJson(req);

        // 1) まず LLM。ここで例外が出ても下でフォールバックするように try で囲む
        let qgen;
        try {
            qgen = await llmQueryGen(text, lang, siteHost);
        } catch (err) {
            // LLMが死んだらとりあえずユーザー入力をそのままクエリにする
            qgen = {
                reply_text: '',
                queries: [text].filter(Boolean),
                lang_code: null
            };
        }

        const replyLang =
            qgen.lang_code === 'ja' ? 'ja-JP' :
                qgen.lang_code === 'zh' ? 'zh-CN' :
                    qgen.lang_code === 'en' ? 'en-US' :
                        lang;

        // 2) /api/shop を(なるべく)回す
        const itemsAll = [];
        const SHOP_BASE = process.env.SHOP_BASE || 'https://ergonomics-mu.vercel.app';

        for (const q of qgen.queries) {
            try {
                const r = await fetchWithTimeout(`${SHOP_BASE}/api/shop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, siteHost, lang: replyLang })
                }, 5500); // 5.5秒で切る
                const j = await r.json().catch(() => null);
                if (j?.ok && Array.isArray(j.items)) {
                    for (const it of j.items) {
                        const key = (it.title || '') + (it.url || '');
                        if (!itemsAll.find(x => (x.title || '') + (x.url || '') === key)) {
                            itemsAll.push(it);
                        }
                        if (itemsAll.length >= 6) break;
                    }
                }
            } catch (err) {
                // 1件コケても無視
            }
            if (itemsAll.length >= 6) break;
        }

        // 3) レスポンス組み立て
        const top = itemsAll.slice(0, 3);
        const messages = [];

        messages.push({
            role: 'assistant',
            type: 'text',
            content: qgen.reply_text || localeMsg(replyLang, top.length ? 'here' : 'notFound')
        });

        if (top.length > 0) {
            messages.push({ role: 'assistant', type: 'products', items: top });
            messages.push({ role: 'assistant', type: 'text', content: localeMsg(replyLang, 'refine') });
        } else {
            // ECサイトにいるなら検索リンクを1個返す
            if (siteHost && isEcomHost(siteHost) && qgen.queries[0]) {
                const url = buildSiteSearchUrl(siteHost, qgen.queries[0]);
                messages.push({
                    role: 'assistant',
                    type: 'products',
                    items: [
                        {
                            title: replyLang.startsWith('ja')
                                ? `${siteHost} で「${qgen.queries[0]}」を検索`
                                : replyLang.startsWith('zh')
                                    ? `在 ${siteHost} 上搜索「${qgen.queries[0]}」`
                                    : `Search “${qgen.queries[0]}” on ${siteHost}`,
                            url,
                            price: '',
                            source: siteHost
                        }
                    ]
                });
            }
            messages.push({ role: 'assistant', type: 'text', content: localeMsg(replyLang, 'refine') });
        }

        return res.status(200).json({
            ok: true,
            reply_lang: replyLang,
            messages
        });
    } catch (e) {
        console.error('[chatbot] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
