// api/chatbot.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || '{}'); } catch { return {}; }
}

// 多言語メッセージ
function localeMsg(lang, key) {
    const ja = {
        refine: '価格帯・ブランド・用途を言ってくれればさらに絞れます。',
        here: 'このあたりが候補です。',
        notFound: 'すみません、その条件で明確な商品は見つかりませんでした。',
        fallback: '代わりに、人気のノートPCをいくつか出しておきます。'
    };
    const zh = {
        refine: '说下预算/品牌/用途，我可以再筛选。',
        here: '这些是候选。',
        notFound: '抱歉，没找到很匹配的商品。',
        fallback: '先给你推荐几款常见的笔记本电脑。'
    };
    const en = {
        refine: 'Tell me budget/brand/use case to refine.',
        here: 'Here are some options.',
        notFound: 'Sorry, I couldn’t find a strong match.',
        fallback: 'Here are some common laptops instead.'
    };
    const L = lang?.startsWith('ja') ? ja : lang?.startsWith('zh') ? zh : en;
    return L[key];
}

// ECっぽいドメインか
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

// ECサイト検索URLをでっちあげる
function buildSiteSearchUrl(host, query) {
    const h = host.toLowerCase();
    const q = encodeURIComponent(query);
    if (h.includes('jd.com')) return `https://search.jd.com/Search?keyword=${q}`;
    if (h.includes('amazon.')) return `https://${host}/s?k=${q}`;
    if (h.includes('rakuten.')) return `https://${host}/search/mall/${q}/`;
    return `https://${host}/search?q=${q}`;
}

// 言語別の「これ投げとけばPC出る」クエリ
function getFallbackQueries(lang) {
    if (lang.startsWith('ja')) {
        return ['ノートパソコン', 'レノボ ノートパソコン', 'ゲーミング ノートPC'];
    }
    if (lang.startsWith('zh')) {
        return ['笔记本电脑', '联想 笔记本电脑', '游戏本'];
    }
    return ['laptop', 'lenovo laptop', 'gaming laptop'];
}

// 本当に何も無かったときに出す固定カード
function getHardcodedProducts(lang) {
    if (lang.startsWith('ja')) {
        return [
            {
                title: 'Lenovo IdeaPad Slim 5 (Ryzen / 16GB / 512GB)',
                price: '¥79,800 (参考)',
                url: 'https://www.lenovo.com/',
                source: 'sample'
            },
            {
                title: 'ASUS VivoBook 14 (i5 / 16GB)',
                price: '¥72,000 (参考)',
                url: 'https://www.asus.com/',
                source: 'sample'
            },
            {
                title: 'Dell Inspiron 14 (学生向け)',
                price: '¥68,000 (参考)',
                url: 'https://www.dell.com/',
                source: 'sample'
            }
        ];
    }
    if (lang.startsWith('zh')) {
        return [
            {
                title: '联想 小新 Air / Pro 系列 笔记本',
                price: '￥4,500 起 (示例)',
                url: 'https://www.lenovo.com/',
                source: 'sample'
            },
            {
                title: '华硕 VivoBook 14 学生本',
                price: '￥4,000 起 (示例)',
                url: 'https://www.asus.com/',
                source: 'sample'
            },
            {
                title: '戴尔 Inspiron 14 入门本',
                price: '￥3,800 起 (示例)',
                url: 'https://www.dell.com/',
                source: 'sample'
            }
        ];
    }
    return [
        {
            title: 'Lenovo IdeaPad 5 14" (16GB / 512GB)',
            price: '$599 (example)',
            url: 'https://www.lenovo.com/',
            source: 'sample'
        },
        {
            title: 'ASUS VivoBook 14',
            price: '$549 (example)',
            url: 'https://www.asus.com/',
            source: 'sample'
        },
        {
            title: 'Dell Inspiron 14',
            price: '$529 (example)',
            url: 'https://www.dell.com/',
            source: 'sample'
        }
    ];
}

// ①最初のクエリを作るLLM（今までのやつ）
async function llmQueryGen(text, lang, siteHost) {
    const system = `
You are a shopping assistant.
- Detect user's language and ALWAYS respond in that language.
- Produce EXACT JSON (no extra text) with up to 3 "queries" for product search.
- Also output "lang_code" with best guess for the user's message (ja/zh/en).
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

// ②0件のときだけ呼ぶ「クエリ直し」LLM
async function llmSearchRewrite(userText, badQuery, lang, siteHost) {
    const system = `
You are an e-commerce query normalizer.
Goal:
- If the current query looks like stationery (e.g. "20 notebooks") but the user text suggests "notebook computer / laptop", rewrite it to laptop queries.
- Otherwise, make the query more e-commerce-friendly.
Return EXACT JSON only.
Response schema:
{
  "queries": ["string", "string", "string"]
}
`;
    const user = `
User text (${lang}): ${userText}
First query (possibly wrong): ${badQuery}
Current site: ${siteHost || '(none)'}
`;

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
    if (!resp.ok) throw new Error(j?.error?.message || 'rewrite error');

    let obj = {};
    try { obj = JSON.parse(j.choices?.[0]?.message?.content || '{}'); } catch { }
    const qs = Array.isArray(obj.queries) ? obj.queries.filter(Boolean) : [];
    return qs.length ? qs : [userText].filter(Boolean);
}

// fetch にタイムアウトをつける
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

        // 1) LLMで一次クエリ
        let qgen;
        try {
            qgen = await llmQueryGen(text, lang, siteHost);
        } catch {
            qgen = { reply_text: '', queries: [text].filter(Boolean), lang_code: null };
        }

        const replyLang =
            qgen.lang_code === 'ja' ? 'ja-JP' :
                qgen.lang_code === 'zh' ? 'zh-CN' :
                    qgen.lang_code === 'en' ? 'en-US' :
                        lang;

        const itemsAll = [];
        const SHOP_BASE = process.env.SHOP_BASE || 'https://ergonomics-mu.vercel.app';

        // 2) 一次クエリで検索
        for (const q of qgen.queries) {
            try {
                const r = await fetchWithTimeout(`${SHOP_BASE}/api/shop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, siteHost, lang: replyLang })
                }, 5000);
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
            } catch { /* 無視して次 */ }
            if (itemsAll.length >= 6) break;
        }

        // 3) まだ0件なら → LLMでクエリをリライトしてもう一回だけ検索
        if (itemsAll.length === 0) {
            try {
                const rewrites = await llmSearchRewrite(text, qgen.queries[0] || '', replyLang, siteHost);
                for (const rq of rewrites) {
                    try {
                        const r = await fetchWithTimeout(`${SHOP_BASE}/api/shop`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ query: rq, siteHost, lang: replyLang })
                        }, 5000);
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
                    } catch { /* 無視 */ }
                    if (itemsAll.length >= 6) break;
                }
            } catch {
                // リライト自体が失敗したら何もしない
            }
        }

        // 4) それでも0件なら → 言語別フォールバッククエリを投げてみる
        if (itemsAll.length === 0) {
            const fbQueries = getFallbackQueries(replyLang);
            for (const q of fbQueries) {
                try {
                    const r = await fetchWithTimeout(`${SHOP_BASE}/api/shop`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query: q, siteHost, lang: replyLang })
                    }, 5000);
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
                } catch { /* 無視 */ }
                if (itemsAll.length >= 6) break;
            }
        }

        // 5) 応答を組み立てる
        const messages = [];

        // 最初のテキスト
        messages.push({
            role: 'assistant',
            type: 'text',
            content: qgen.reply_text || (itemsAll.length ? localeMsg(replyLang, 'here') : localeMsg(replyLang, 'notFound'))
        });

        if (itemsAll.length > 0) {
            messages.push({
                role: 'assistant',
                type: 'products',
                items: itemsAll.slice(0, 3)
            });
            messages.push({
                role: 'assistant',
                type: 'text',
                content: localeMsg(replyLang, 'refine')
            });
        } else {
            // ECサイトなら「このサイトで検索」を1枚
            if (siteHost && isEcomHost(siteHost) && qgen.queries[0]) {
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
                            url: buildSiteSearchUrl(siteHost, qgen.queries[0]),
                            price: '',
                            source: siteHost
                        }
                    ]
                });
            }
            // ハードコードのPCも出す
            messages.push({
                role: 'assistant',
                type: 'text',
                content: localeMsg(replyLang, 'fallback')
            });
            messages.push({
                role: 'assistant',
                type: 'products',
                items: getHardcodedProducts(replyLang)
            });
            messages.push({
                role: 'assistant',
                type: 'text',
                content: localeMsg(replyLang, 'refine')
            });
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
