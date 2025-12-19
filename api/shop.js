// api/shop.js
const cheerio = require("cheerio");

const SERPAPI_KEY = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || "";

// best-effort in-memory cache (serverlessでは揮発することがあります)
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
const getCache = (k) => {
    const v = cache.get(k);
    if (!v) return null;
    if (Date.now() - v.t > CACHE_TTL_MS) { cache.delete(k); return null; }
    return v.data;
};
const setCache = (k, data) => cache.set(k, { t: Date.now(), data });

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try { return JSON.parse(body || "{}"); } catch { return {}; }
}

async function fetchWithTimeout(url, opt = {}, ms = 6500) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opt, signal: ctrl.signal }); }
    finally { clearTimeout(id); }
}

const cleanText = (s) => String(s || "").replace(/\s+/g, " ").trim();

function normalizeUrl(u) {
    const s = (u || "").trim();
    if (!s) return "";
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    return s;
}

function looksBlocked(html) {
    const h = String(html || "");
    return (
        h.includes("captcha") ||
        h.includes("请完成验证") ||
        h.includes("安全验证") ||
        h.includes("访问过于频繁") ||
        h.toLowerCase().includes("verify")
    );
}

async function fetchJdPrices(skus = []) {
    const list = skus.filter(Boolean).slice(0, 20);
    if (!list.length) return new Map();

    const skuIds = list.map(id => `J_${id}`).join(",");
    const url = `https://p.3.cn/prices/mgets?skuIds=${encodeURIComponent(skuIds)}&type=1`;

    try {
        const r = await fetchWithTimeout(url, {
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json,text/plain,*/*",
                "Referer": "https://search.jd.com/"
            }
        }, 4500);

        const arr = await r.json().catch(() => null);
        const map = new Map();
        if (Array.isArray(arr)) {
            for (const row of arr) {
                const id = String(row?.id || "").replace(/^J_/, "");
                const p = row?.p || row?.op || row?.m || null;
                if (id) map.set(id, p ? String(p) : null);
            }
        }
        return map;
    } catch {
        return new Map();
    }
}

async function searchJD({ query, limit = 6, page = 1 }) {
    const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(query)}&enc=utf-8&page=${encodeURIComponent(page)}`;

    const r = await fetchWithTimeout(url, {
        headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            "Referer": "https://www.jd.com/"
        }
    }, 6500);

    const html = await r.text();

    if (looksBlocked(html)) {
        return { ok: false, error: "JD_BLOCKED_OR_CAPTCHA", items: [] };
    }

    const $ = cheerio.load(html);

    const raw = [];
    $("#J_goodsList li.gl-item").each((_, el) => {
        if (raw.length >= limit * 3) return;

        const sku = cleanText($(el).attr("data-sku"));
        const title =
            cleanText($(el).find(".p-name em").text()) ||
            cleanText($(el).find(".p-name").text());

        const href = $(el).find(".p-name a").attr("href");
        const itemUrl = normalizeUrl(href);

        const imgEl = $(el).find(".p-img img").first();
        const img =
            imgEl.attr("data-lazy-img") ||
            imgEl.attr("data-lazy-img-slave") ||
            imgEl.attr("src") || "";
        const image = normalizeUrl(img);

        const shopName = cleanText($(el).find(".p-shop a").first().text());
        const priceText = cleanText($(el).find(".p-price i").first().text());
        const badge = cleanText($(el).find(".p-icons i").first().text());

        raw.push({ sku, title, url: itemUrl, image, shopName, badge, priceText: priceText || null });
    });

    // dedupe
    const seen = new Set();
    const items = [];
    for (const it of raw) {
        const key = it.sku ? `sku:${it.sku}` : `url:${it.url}`;
        if (!it.title || !it.url || seen.has(key)) continue;
        seen.add(key);
        items.push(it);
        if (items.length >= limit) break;
    }

    const needPriceSkus = items.filter(it => it.sku && !it.priceText).map(it => it.sku);
    const priceMap = await fetchJdPrices(needPriceSkus);

    const out = items.map(it => {
        const p = it.priceText || priceMap.get(it.sku) || null;
        const price = p ? (String(p).includes("￥") ? String(p) : `￥${p}`) : null;

        const descParts = [];
        if (it.badge) descParts.push(it.badge);
        if (it.shopName) descParts.push(it.shopName);
        const description = descParts.length ? descParts.join(" · ") : null;

        return {
            title: it.title,
            description,
            price,
            image: it.image || "",
            url: it.url,
            source: it.shopName ? `JD · ${it.shopName}` : "JD"
        };
    });

    return { ok: true, items: out };
}

async function searchSerpApi({ q, gl = "jp", hl = "ja" }) {
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google_shopping");
    url.searchParams.set("q", q);
    url.searchParams.set("api_key", SERPAPI_KEY);
    url.searchParams.set("gl", gl);
    url.searchParams.set("hl", hl);

    const r = await fetchWithTimeout(url.toString(), {}, 6500);
    const json = await r.json();
    const results = json?.shopping_results || json?.organic_results || [];
    return results.map(r => ({
        title: r.title,
        price: r.price || r.extracted_price || r.price_str || null,
        image: r.thumbnail || r.thumbnail_url || r.product_photos?.[0] || "",
        url: r.link || r.product_link || r.redirect_link || "",
        source: r.source || ""
    }));
}

module.exports = async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const { query = "", siteHost = "", lang = "ja-JP", provider = "", limit = 6, page = 1 } = await readJson(req);

    const host = String(siteHost || "").toLowerCase();
    const providerNorm = String(provider || "").toLowerCase();
    const isJD = providerNorm === "jd" || host.includes("jd.com");

    const cacheKey = JSON.stringify({ isJD, query, host: isJD ? "jd" : host, lang, limit, page });
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    try {
        if (isJD) {
            const r = await searchJD({ query, limit: Math.max(1, Math.min(12, Number(limit) || 6)), page: Math.max(1, Number(page) || 1) });
            const out = r.ok
                ? { ok: true, items: r.items, provider: "jd", siteHost }
                : { ok: false, error: r.error, provider: "jd", siteHost };
            setCache(cacheKey, out);
            return res.status(200).json(out);
        }

        if (!SERPAPI_KEY) {
            const out = { ok: false, error: "SERPAPI_KEY_NOT_SET", provider: "serpapi" };
            setCache(cacheKey, out);
            return res.status(200).json(out);
        }

        const low = (lang || "").toLowerCase();
        const gl = low.includes("zh") ? "cn" : low.includes("ja") ? "jp" : "us";
        const hl = low.includes("zh") ? "zh-CN" : low.includes("ja") ? "ja" : "en";

        const ecCandidates = ["amazon.", "rakuten", "yahoo.", "jd.com", "taobao", "tmall", "aliexpress"];
        const isEC = siteHost && ecCandidates.some(s => siteHost.includes(s));
        const q = isEC ? `site:${siteHost} ${query}` : query;

        const items = await searchSerpApi({ q, gl, hl });
        const out = { ok: true, items, provider: "serpapi", siteHost, q };
        setCache(cacheKey, out);
        return res.status(200).json(out);
    } catch (e) {
        return res.status(200).json({ ok: false, error: String(e) });
    }
};
