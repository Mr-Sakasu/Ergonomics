import 'dotenv/config'; // ← これ1行で .env が読み込まれる
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());
import { HttpsProxyAgent } from 'https-proxy-agent';

// ====== env ======
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com';
const JD_APP_KEY = process.env.JD_APP_KEY || '';
const JD_APP_SECRET = process.env.JD_APP_SECRET || '';
const JD_API_URL = 'https://api.jd.com/routerjson';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
if (proxyAgent) {
    console.log('[SRV] proxy agent enabled →', proxyUrl);
}

// ====== simple logger with request id ======
let REQ_COUNTER = 0;
app.use((req, _res, next) => {
    const id = ++REQ_COUNTER;
    // reqIdをリクエストに乗せる
    req.reqId = id;
    console.log(`[SRV#${id}] ${req.method} ${req.url}`);
    if (req.method !== 'GET') {
        console.log(`[SRV#${id}] body=`, JSON.stringify(req.body, null, 2));
    }
    next();
});

// health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ====== helper ======
function jdSign(params, appSecret) {
    const keys = Object.keys(params).sort();
    let s = appSecret;
    for (const k of keys) {
        const v = params[k];
        if (v !== undefined && v !== null && v !== '') s += k + v;
    }
    s += appSecret;
    return crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

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

// ====== old /chat ======
app.post('/chat', (req, res) => {
    const title = req.body?.product?.title || 'この商品';
    res.json({
        ok: true,
        summary: `${title} は用途が合えば買っていいと思います。価格と保証だけ確認してください。`,
        checklist: [
            'オーバースペックじゃないか',
            '同価格帯より極端に高くないか',
            '返品・保証条件が分かるか'
        ]
    });
});

// ====== /jd/search ======
app.post('/jd/search', async (req, res) => {
    const reqId = req.reqId;
    const { keyword = 'おすすめ' } = req.body || {};
    console.log(`[SRV#${reqId}] /jd/search keyword="${keyword}"`);

    // キーが無いときは即モック
    if (!JD_APP_KEY || !JD_APP_SECRET) {
        console.log(
            `[SRV#${reqId}] JD_APP_KEY / JD_APP_SECRET が設定されていないためモックを返します`
        );
        return res.json({
            ok: true,
            provider: 'jd-mock',
            keyword,
            results: [1, 2, 3].map(i => ({
                provider: 'jd',
                title: `${keyword} JDモック ${i}`,
                price: 99 + i * 10,
                url: '',
                summary: 'JDキー未設定のためモックを返しています。'
            }))
        });
    }

    try {
        const paramJson = { goodsReq: { keyword, pageIndex: 1, pageSize: 10 } };
        const baseParams = {
            method: 'jd.union.open.goods.query',
            app_key: JD_APP_KEY,
            v: '1.0',
            format: 'json',
            sign_method: 'md5',
            timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
            '360buy_param_json': JSON.stringify(paramJson)
        };
        const sign = jdSign(baseParams, JD_APP_SECRET);
        const body = new URLSearchParams({ ...baseParams, sign });

        console.log(`[SRV#${reqId}] → JD POST ${JD_API_URL}`);
        const resp = await fetch(JD_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body
        });
        const data = await resp.json();
        console.log(`[SRV#${reqId}] ← JD status=${resp.status}`);

        // ここでは生を返す（/chatbot 側で整形する）
        res.json({ ok: true, provider: 'jd', raw: data });
    } catch (e) {
        console.error(`[SRV#${reqId}] jd/search error:`, e.stack || e);
        res.json({ ok: false, error: String(e) });
    }
});

// ====== /search (mock) ======
app.post('/search', (req, res) => {
    const reqId = req.reqId;
    const { keyword = 'おすすめ', provider = 'jd' } = req.body || {};
    console.log(`[SRV#${reqId}] /search (mock) keyword="${keyword}" provider="${provider}"`);
    const items = [1, 2, 3].map(i => ({
        provider,
        title: `${keyword} ${provider.toUpperCase()} モック商品 ${i}`,
        price: 99 + i * 10,
        rating: 4.3,
        reviewCount: 20 + i * 5,
        summary: 'モック検索です。'
    }));
    res.json({ ok: true, results: items });
});

// ====== /chatbot ======
app.post('/chatbot', async (req, res) => {
    const reqId = req.reqId;
    const started = Date.now();

    const { text = '', lang = 'ja-JP', provider = 'jd' } = req.body || {};
    console.log(
        `[SRV#${reqId}] /chatbot start text="${text}" lang=${lang} provider=${provider}`
    );

    // 1. JD候補を取る
    let jdItems = [];
    try {
        console.log(`[SRV#${reqId}] calling internal /jd/search ...`);
        const r = await fetch('http://localhost:8787/jd/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: text })
        });
        const j = await r.json();
        if (j.ok && Array.isArray(j.results)) {
            jdItems = j.results.slice(0, 3);
            console.log(`[SRV#${reqId}] /jd/search ok; got ${j.results.length} items`);
        } else {
            console.log(`[SRV#${reqId}] /jd/search returned no results, j=`, j);
        }
    } catch (e) {
        console.warn(
            `[SRV#${reqId}] /chatbot: /jd/search failed, fallback to mock. err=`,
            e.stack || e
        );
    }

    // JDがゼロならフォールバック
    if (!jdItems.length) {
        jdItems = [1, 2, 3].map(i => ({
            title: `${text || '商品'} (JD mock ${i})`,
            price: 100 + i * 10,
            url: '',
            reasons: []
        }));
        console.log(`[SRV#${reqId}] JD fallback used`);
    }

    // 2. OpenAIが無ければモックで返す
    if (!OPENAI_API_KEY) {
        console.log(`[SRV#${reqId}] OPENAI_API_KEY is not set → fallback response`);
        const fallback = buildMultilingualFallback(lang, jdItems);
        const elapsed = Date.now() - started;
        console.log(`[SRV#${reqId}] /chatbot end (fallback) in ${elapsed}ms`);
        return res.json(fallback);
    }

    // 3. LLMに投げる準備
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
- User is browsing JingDong (JD) or similar CN e-commerce.
- Show 2-3 recommendations from the list I give you.
- Be concise (max 120 chars per item).
`;

    const userPrompt = `
User message (${lang}): ${text}

Here are JD candidates:
${productsText}

Please recommend 2–3 items from above, and tell the user what to check (price, shipping, warranty) in the SAME language.
`;

    // 4. OpenAIを呼ぶ
    let assistantText;
    try {
        console.log(`[SRV#${reqId}] → OpenAI chat.completions ...`);
        const openaiResp = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            }),
            // ここが今回のポイント 👇
            agent: proxyAgent || undefined
        });


        console.log(`[SRV#${reqId}] ← OpenAI status=${openaiResp.status}`);

        const openaiJson = await openaiResp.json();
        // ログに全文を出すと長いので先頭だけ
        const raw = JSON.stringify(openaiJson).slice(0, 400);
        console.log(`[SRV#${reqId}] OpenAI resp head=${raw}...`);

        assistantText =
            openaiJson?.choices?.[0]?.message?.content ||
            (lang.startsWith('zh')
                ? '好的，这是几款你可以先看看：'
                : lang.startsWith('ja')
                    ? '了解です。以下が候補です。'
                    : 'Here are some candidates.');
    } catch (e) {
        console.error(`[SRV#${reqId}] OpenAI call failed:`, e.stack || e);
        assistantText = lang.startsWith('zh')
            ? '我先给你看这几款：'
            : lang.startsWith('ja')
                ? 'とりあえずこのあたりが候補です：'
                : 'Here are some candidates:';
    }

    const payload = {
        ok: true,
        reply_lang: lang,
        messages: [
            { role: 'assistant', type: 'text', content: assistantText },
            { role: 'assistant', type: 'products', items: jdItems },
            {
                role: 'assistant',
                type: 'text',
                content:
                    lang.startsWith('zh')
                        ? '如果你要我再按价格/品牌/是否自营筛选，可以继续说。'
                        : lang.startsWith('ja')
                            ? '価格・ブランド・京東自営かどうかで絞りたい場合は続けて送ってください。'
                            : 'Tell me price/brand/self-operated if you want a narrower list.'
            }
        ]
    };

    const elapsed = Date.now() - started;
    console.log(`[SRV#${reqId}] /chatbot end in ${elapsed}ms`);
    res.json(payload);
});

// ====== start ======
const PORT = process.env.PORT || 8787;
app.listen(PORT, () => {
    console.log('[SRV] running on http://localhost:' + PORT);
    console.log('[SRV] process.cwd() =', process.cwd());
    console.log('[SRV] OPENAI_API_KEY =', process.env.OPENAI_API_KEY ? '***SET***' : 'NOT SET');
    console.log('[SRV] JD_APP_KEY =', process.env.JD_APP_KEY ? '***SET***' : 'NOT SET');
    console.log('[SRV] JD_APP_SECRET =', process.env.JD_APP_SECRET ? '***SET***' : 'NOT SET');
});
