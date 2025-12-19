// api/shop.js
const cheerio = require('cheerio');

const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || '';

async function readJson(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || '{}'); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 6500) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opt, signal: ctrl.signal });
    } finally {
        clearTimeout(id);
    }
}

function cleanText(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(u) {
    const s = (u || '').trim();
    if (!s) return '';
    if (s.startsWith('//')) return `https:${s}`;
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    // JDは //item.jd.com/... 形式が多いので基本は https: を付ける
    if (s.startsWith('/')) return `https://item.jd.com${s}`;
    return s;
}

async function fetchJdPrices(skus = []) {
    // skuIds=J_123,J_456
    const list = skus.filter(Boolean).slice(0, 20);
    if (list.length === 0) return new Map();

    const skuIds = list.map(id => `J_${id}`).join(',');
    const url = `https://p.3.cn/prices/mgets?skuIds=${encodeURIComponent(skuIds)}&type=1`;

    try {
        const r = await fetchWithTimeout(url, {
            headers: {
                // “普通のブラウザ”っぽいヘッダにする（突破行為ではなく最低限の互換性）
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json,text/plain,*/*',
                'Referer': 'https://search.jd.com/'
            }
        }, 4500);

        const arr = await r.json().catch(() => null);
        const map = new Map();
        if (Array.isArray(arr)) {
            for (const row of arr) {
                const id = String(row?.id || '').replace(/^J_/, '');
                const p = row?.p || row?.op || row?.m || null; // p:现价, op:原价 など
                if (id) map.set(id, p ? String(p) : null);
            }
        }
        return map;
    } catch {
        return new Map();
    }
}

async function searchJD({ query, limit = 6 }) {
    if (!query || !query.trim()) return [];

    // enc=utf-8 を付けておく（文字化け回避）
    const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}&enc=utf-8`;
    const r = await fetchWithTimeout(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
        }
    }, 6500);

    const html = await r.text();
    const $ = cheerio.load(html);

    const raw = [];
    $('#J_goodsList li.gl-item').each((_, el) => {
        if (raw.length >= limit * 3) return;

        const sku = cleanText($(el).attr('data-sku'));
        const title =
            cleanText($(el).find('.p-name em').text()) ||
            cleanText($(el).find('.p-name').text());

        const href = $(el).find('.p-name a').attr('href');
        const url = normalizeUrl(href);

        const imgEl = $(el).find('.p-img img').first();
        const img =
            imgEl.attr('data-lazy-img') ||
            imgEl.attr('data-lazy-img-slave') ||
            imgEl.attr('src') ||
            '';
        const image = normalizeUrl(img);

        // 店舗名（出ない場合もある）
        const shopName = cleanText($(el).find('.p-shop a').first().text());

        // HTML内に価格が居る場合もある（居ないことも多い）
        const priceText = cleanText($(el).find('.p-price i').first().text());

        // 自营/タグなど（説明に回せる）
        const badge = cleanText($(el).find('.p-icons i').first().text());

        raw.push({
            sku,
            title,
            url,
            image,
            shopName,
            badge,
            priceText: priceText || null
        });
    });

    // まず重複排除（sku優先）
    const seen = new Set();
    const items = [];
    for (const it of raw) {
        const key = it.sku ? `sku:${it.sku}` : `url:${it.url}`;
        if (!it.title || !it.url || seen.has(key)) continue;
        seen.add(key);
        items.push(it);
        if (items.length >= limit) break;
    }

    // 価格補完（必要なskuだけ）
    const needPriceSkus = items
        .filter(it => it.sku && !it.priceText)
        .map(it => it.sku);

    const priceMap = await fetchJdPrices(needPriceSkus);

    return items.map(it => {
        const p = it.priceText || priceMap.get(it.sku) || null;
        const price = p ? (String(p).includes('￥') ? String(p) : `￥${p}`) : null;

        const descParts = [];
        if (it.badge) descParts.push(it.badge);
        if (it.shopName) descParts.push(it.shopName);
        const description = descParts.length ? descParts.join(' · ') : null;

        return {
            title: it.title,
            description,         // ← “説明”としてカードに出せる
            price,
            image: it.image || '',
            url: it.url,
            source: it.shopName ? `JD · ${it.shopName}` : 'JD'
        };
    });
}

// 既存SerpAPIはそのまま残す（他サイト用）
async function searchSerpApi({ q, country = 'jp', gl = 'jp', hl = 'ja' }) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_shopping');
    url.searchParams.set('q', q);
    url.searchParams.set('api_key', SERPAPI_KEY);
    url.searchParams.set('gl', gl);
    url.searchParams.set('hl', hl);

    const r = await fetchWithTimeout(url.toString(), {}, 6500);
    const json = await r.json();

    const results = json?.shopping_results || json?.organic_results || [];
    return results.map(r => ({
        title: r.title,
        price: r.price || r.extracted_price || r.price_str || null,
        image: r.thumbnail || r.thumbnail_url || r.product_photos?.[0] || '',
        url: r.link || r.product_link || r.redirect_link || '',
        source: r.source || ''
    }));
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

    const { query = '', siteHost = '', lang = 'ja-JP', provider = '' } = await readJson(req);

    const host = String(siteHost || '').toLowerCase();
    const providerNorm = String(provider || '').toLowerCase();

    // ★ JD優先：provider指定 or siteHost判定
    const isJD = providerNorm === 'jd' || host.includes('jd.com');

    try {
        if (isJD) {
            const items = await searchJD({ query, limit: 6 });
            return res.status(200).json({ ok: true, items, provider: 'jd', siteHost });
        }

        // 非JDは従来通り（SerpAPI未設定ならモック）
        if (!SERPAPI_KEY) {
            const mock = [1, 2, 3].map(i => ({
                title: `${query || 'item'} (mock ${i})`,
                price: 100 * i,
                image: '',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                source: siteHost || 'google'
            }));
            return res.status(200).json({ ok: true, items: mock, provider: 'mock' });
        }

        const low = (lang || '').toLowerCase();
        const gl = low.includes('zh') ? 'cn' : low.includes('ja') ? 'jp' : 'us';
        const hl = low.includes('zh') ? 'zh-CN' : low.includes('ja') ? 'ja' : 'en';
        const country = gl;

        // 既存ロジック（site: を付ける）は残す
        const ecCandidates = ['amazon.', 'rakuten', 'yahoo.', 'jd.com', 'taobao', 'tmall', 'aliexpress'];
        const isEC = siteHost && ecCandidates.some(s => siteHost.includes(s));
        const q = isEC ? `site:${siteHost} ${query}` : query;

        const items = await searchSerpApi({ q, country, gl, hl });
        return res.status(200).json({ ok: true, items, provider: 'serpapi', siteHost, q });
    } catch (e) {
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
