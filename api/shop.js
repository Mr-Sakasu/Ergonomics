// api/shop.js
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

function pickShoppingResults(json) {
    // SerpAPIのショッピング結果を素直に拾う
    const items = [];
    const results =
        json?.shopping_results ||
        json?.organic_results ||
        [];
    for (const r of results) {
        items.push({
            title: r.title,
            price: r.price || r.extracted_price || r.price_str || null,
            image: r.thumbnail || r.thumbnail_url || r.product_photos?.[0],
            url: r.link || r.product_link || r.redirect_link || r.source || '',
            source: r.source || r.store || r.merchant || r.channel || ''
        });
        if (items.length >= 5) break;
    }
    return items;
}

async function searchSerpApi({ q, country = 'jp', gl = 'jp', hl = 'ja' }) {
    const endpoint = new URL('https://serpapi.com/search.json');
    endpoint.searchParams.set('engine', 'google');
    endpoint.searchParams.set('tbm', 'shop');     // Google Shopping
    endpoint.searchParams.set('q', q);
    endpoint.searchParams.set('gl', gl);
    endpoint.searchParams.set('hl', hl);
    endpoint.searchParams.set('google_domain', country === 'cn' ? 'google.com.hk' : 'google.com');
    endpoint.searchParams.set('api_key', SERPAPI_KEY);

    const resp = await fetch(endpoint.toString());
    const json = await resp.json();
    return pickShoppingResults(json);
}

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

    const { query = '', siteHost = '', lang = 'ja-JP' } = await readJson(req);

    if (!SERPAPI_KEY) {
        // フォールバック（モック）
        const mock = [1, 2, 3].map(i => ({
            title: `${query || 'item'} (mock ${i})`,
            price: 100 * i,
            image: '',
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            source: siteHost || 'google'
        }));
        return res.status(200).json({ ok: true, items: mock, provider: 'mock' });
    }

    // locale → 検索の言語/地域に反映（ざっくり）
    const low = (lang || '').toLowerCase();
    const gl = low.startsWith('ja') ? 'jp' : low.startsWith('zh') ? 'cn' : 'us';
    const hl = low.startsWith('ja') ? 'ja' : low.startsWith('zh') ? 'zh' : 'en';
    const country = gl;

    // site内検索（ECっぽいなら site:host を付ける）
    const ecCandidates = ['jd.com', 'taobao.com', 'tmall.com', 'tmall.hk', 'tmall', 'pinduoduo', 'douyin', 'amazon', 'rakuten', 'yahoo', 'yodobashi', 'biccamera', 'kakaku', 'bestbuy', 'walmart', 'newegg', 'mercari', 'auctions.yahoo'];
    const isEC = siteHost && ecCandidates.some(s => siteHost.includes(s));
    const q = isEC ? `site:${siteHost} ${query}` : query;

    try {
        const items = await searchSerpApi({ q, country, gl, hl });
        return res.status(200).json({ ok: true, items, provider: 'serpapi', siteHost, isEC });
    } catch (e) {
        console.error('[shop] error', e);
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
