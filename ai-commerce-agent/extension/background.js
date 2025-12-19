console.log('[AIC] BG loaded');

const API_BASE = 'https://ergonomics-mu.vercel.app/api';
const DEFAULT_TIMEOUT_MS = 12000;

function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function langBase(lang = '') {
    const s = String(lang || '').toLowerCase();
    return s.split(/[-_]/)[0] || 'en';
}
function uiStrings(userLang = 'en-US') {
    const b = langBase(userLang);
    if (b === 'ja') return {
        found: '以下が見つかりました。',
        notFound: 'すみません、今回は見つかりませんでした。キーワードや条件を少し変えてみてください。',
        blocked: 'JD側で検証が出た可能性があります。JDのページで一度検証してからもう一度試してください。',
        refine: '予算・ブランド・用途を言ってくれればさらに絞れます。',
        openSearch: 'JDで検索を開く',
        errNetwork: '通信に失敗しました（サーバー/ネットワーク）。',
    };
    if (b === 'zh') return {
        found: '找到了以下商品。',
        notFound: '这次没有找到，请再补充一点关键词或条件。',
        blocked: '京东可能触发了验证。请先在京东页面完成验证后再试一次。',
        refine: '说下预算/品牌/用途，我可以再筛选。',
        openSearch: '打开京东搜索',
        errNetwork: '网络/服务端请求失败。',
    };
    return {
        found: 'Here are the products I found.',
        notFound: 'I couldn’t find it this time. Please add more keywords or constraints.',
        blocked: 'JD may have shown a verification step. Please open JD, complete verification, then try again.',
        refine: 'Tell me budget/brand/use case to refine.',
        openSearch: 'Open JD search',
        errNetwork: 'Network/server request failed.',
    };
}

function buildJdSearchUrl(q) {
    return `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}&enc=utf-8`;
}

// ---- Promisify chrome.* ----
function pTabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
        chrome.tabs.create(createProperties, (tab) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(tab);
        });
    });
}
function pTabsRemove(tabId) {
    return new Promise((resolve) => chrome.tabs.remove(tabId, () => resolve()));
}
function pTabsGet(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.get(tabId, (tab) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(tab);
        });
    });
}
function pExecuteScript(details) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(details, (results) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(results || []);
        });
    });
}

async function waitTabComplete(tabId, timeoutMs = 20000) {
    // 先に現在状態を確認（race対策）
    try {
        const t = await pTabsGet(tabId);
        if (t?.status === 'complete') return true;
    } catch (_) { }

    return await new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            cleanup();
            reject(new Error('tab_load_timeout'));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(t);
            chrome.tabs.onUpdated.removeListener(onUpdated);
        };

        const onUpdated = (id, info) => {
            if (id !== tabId) return;
            if (info && info.status === 'complete') {
                cleanup();
                resolve(true);
            }
        };

        chrome.tabs.onUpdated.addListener(onUpdated);
    });
}

async function waitForJdResults(tabId, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const rs = await pExecuteScript({
            target: { tabId },
            func: () => {
                const bodyText = (document.body?.innerText || '').slice(0, 2000);

                const blocked =
                    /验证|安全验证|captcha|访问过于频繁/i.test(bodyText) &&
                    !document.querySelector('#J_goodsList') &&
                    document.querySelectorAll('[data-sku]').length === 0;

                const oldCount = document.querySelectorAll('#J_goodsList li.gl-item').length;
                const newCount = document.querySelectorAll('[data-sku]').length; // ← 新DOM用

                return { blocked, count: oldCount + newCount };
            },
        }).catch(() => null);

        const r0 = rs?.[0]?.result;
        if (r0?.blocked) return { blocked: true, ready: false };
        if ((r0?.count || 0) > 0) return { blocked: false, ready: true };

        await sleep(400);
    }
    return { blocked: false, ready: false };
}


async function fetchJdPrices(skus = []) {
    const list = (skus || []).filter(Boolean).slice(0, 20);
    const map = new Map();
    if (!list.length) return map;

    const skuIds = list.map((id) => `J_${id}`).join(',');
    const url = `https://p.3.cn/prices/mgets?skuIds=${encodeURIComponent(skuIds)}&type=1`;

    try {
        const r = await fetchWithTimeout(
            url,
            {
                headers: {
                    Accept: 'application/json,text/plain,*/*',
                    'Cache-Control': 'no-cache',
                    Pragma: 'no-cache',
                    Referer: 'https://search.jd.com/',
                },
            },
            6500
        );
        const arr = await r.json().catch(() => null);
        if (Array.isArray(arr)) {
            for (const row of arr) {
                const id = String(row?.id || '').replace(/^J_/, '');
                const p = row?.p || row?.op || row?.m || null;
                if (id) map.set(id, p ? String(p) : null);
            }
        }
    } catch (_) { }
    return map;
}

async function scrapeJdSearchOnce(query, limit = 6) {
    const url = buildJdSearchUrl(query);
    const tab = await pTabsCreate({ url, active: false });

    try {
        await waitTabComplete(tab.id, 20000);

        const w = await waitForJdResults(tab.id, 12000);
        if (w.blocked) return { ok: true, blocked: true, items: [] };

        await sleep(500);

        const results = await pExecuteScript({
            target: { tabId: tab.id },
            args: [Number(limit || 6)],
            func: (LIMIT) => {
                const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
                const normUrl = (u) => {
                    const s = clean(u);
                    if (!s) return '';
                    if (s.startsWith('//')) return `https:${s}`;
                    if (s.startsWith('http://') || s.startsWith('https://')) return s;
                    return s;
                };

                const bodyText = (document.body?.innerText || '').slice(0, 2000);
                const blocked =
                    /验证|安全验证|captcha|访问过于频繁/i.test(bodyText) &&
                    !document.querySelector('#J_goodsList') &&
                    document.querySelectorAll('[data-sku]').length === 0;

                // ---- 1) 旧DOM（従来） ----
                const oldNodes = Array.from(document.querySelectorAll('#J_goodsList li.gl-item'));

                // ---- 2) 新DOM（data-skuベース） ----
                // 画像・タイトルがある“それっぽいカード”だけに絞る
                const newNodesAll = Array.from(document.querySelectorAll('[data-sku]'));
                const newNodes = newNodesAll.filter((el) => {
                    const sku = clean(el.getAttribute('data-sku'));
                    if (!sku) return false;
                    const hasImg = !!el.querySelector('img');
                    const hasTitle = !!(el.querySelector('span[title]') || el.querySelector('[title]'));
                    return hasImg && hasTitle;
                });

                const nodes = oldNodes.length ? oldNodes : newNodes;

                const raw = [];
                for (const node of nodes) {
                    if (raw.length >= LIMIT * 4) break;

                    const sku = clean(node.getAttribute('data-sku'));
                    if (!sku) continue;

                    let title = '';
                    let itemUrl = '';
                    let imgUrl = '';
                    let priceText = '';
                    let shopName = '';
                    let badge = '';

                    const isOld = node.matches('li.gl-item') || !!node.querySelector('.p-name');

                    if (isOld) {
                        title =
                            clean(node.querySelector('.p-name em')?.textContent) ||
                            clean(node.querySelector('.p-name')?.textContent);

                        const a = node.querySelector('.p-name a');
                        itemUrl = normUrl(a?.getAttribute('href'));

                        const img = node.querySelector('.p-img img');
                        imgUrl = normUrl(
                            img?.getAttribute('data-lazy-img') ||
                            img?.getAttribute('data-lazy-img-slave') ||
                            img?.getAttribute('src')
                        );

                        priceText = clean(node.querySelector('.p-price i')?.textContent);
                        shopName = clean(node.querySelector('.p-shop a')?.textContent);
                        badge = clean(node.querySelector('.p-icons i')?.textContent);
                    } else {
                        // ---- 新DOM（あなたのスクショの構造） ----
                        title =
                            clean(node.querySelector('span[title]')?.getAttribute('title')) ||
                            clean(node.querySelector('[title]')?.getAttribute('title')) ||
                            clean(node.textContent).slice(0, 80);

                        const img = node.querySelector('img');
                        imgUrl = normUrl(
                            img?.getAttribute('data-src') ||
                            img?.getAttribute('src') ||
                            img?.getAttribute('data-lazy-img')
                        );

                        // aタグが無い場合が多いのでSKUから構築
                        const a = node.querySelector('a[href]');
                        const href = normUrl(a?.getAttribute('href'));
                        itemUrl = href && href.includes('jd.com') ? href : `https://item.jd.com/${sku}.html`;

                        // 価格はDOMに無い/遅延なことが多い → 後段で p.3.cn を使う
                        priceText = '';

                        shopName = '';
                        badge = '';
                    }

                    if (!title) continue;

                    raw.push({ sku, title, url: itemUrl, image: imgUrl, priceText, shopName, badge });
                }

                // SKUで重複除去
                const seen = new Set();
                const items = [];
                for (const it of raw) {
                    if (!it.sku || seen.has(it.sku)) continue;
                    seen.add(it.sku);
                    items.push(it);
                    if (items.length >= LIMIT) break;
                }

                return { blocked, items };
            },
        });

        const r0 = results?.[0]?.result || { blocked: false, items: [] };
        if (r0.blocked) return { ok: true, blocked: true, items: [] };

        const items0 = Array.isArray(r0.items) ? r0.items : [];

        // 価格が無いSKUは p.3.cn で埋める
        const skusNeed = items0.map((it) => it.sku).filter(Boolean);
        const priceMap = await fetchJdPrices(skusNeed);

        const out = items0.map((it) => {
            const p = it.priceText || priceMap.get(it.sku) || '';
            const price = p ? (String(p).includes('￥') ? String(p) : `￥${p}`) : '';
            const desc = [it.badge, it.shopName].filter(Boolean).join(' · ');
            return {
                title: String(it.title || ''),
                description: desc || '',
                price: price || '',
                image: String(it.image || ''),
                url: String(it.url || ''),
                source: it.shopName ? `JD · ${it.shopName}` : 'JD',
            };
        });

        return { ok: true, blocked: false, items: out };
    } finally {
        try { await pTabsRemove(tab.id); } catch (_) { }
    }
}

function pickZhQuery(queries = [], fallback = '') {
    const list = Array.isArray(queries) ? queries : [];
    const zh = list.find((it) => String(it?.lang || '').toLowerCase().startsWith('zh') && String(it?.q || '').trim());
    if (zh) return String(zh.q).trim();
    const first = list.find((it) => String(it?.q || '').trim());
    return first ? String(first.q).trim() : String(fallback || '').trim();
}

async function scrapeJdWithQueries(queries, fallbackText) {
    const list = Array.isArray(queries) ? queries : [];
    const ordered = [
        ...list.filter((it) => String(it?.lang || '').toLowerCase().startsWith('zh')),
        ...list.filter((it) => !String(it?.lang || '').toLowerCase().startsWith('zh')),
    ].filter((it) => String(it?.q || '').trim());

    const seen = new Set();
    const candidates = ordered
        .map((it) => String(it.q).trim())
        .filter((q) => q && !seen.has(q) && (seen.add(q), true));

    if (!candidates.length && fallbackText) candidates.push(String(fallbackText).trim());

    for (const q of candidates.slice(0, 3)) {
        const r = await scrapeJdSearchOnce(q, 6).catch(() => null);
        if (r?.ok && Array.isArray(r.items) && r.items.length > 0) {
            return { ok: true, blocked: false, usedQuery: q, items: r.items };
        }
        if (r?.blocked) {
            return { ok: false, blocked: true, usedQuery: q, items: [] };
        }
    }
    return { ok: false, blocked: false, usedQuery: candidates[0] || String(fallbackText || '').trim(), items: [] };
}

async function handleAiChat(payload = {}) {
    const text = String(payload.text || '').trim();
    const replyLang = payload.lang || 'ja-JP';
    const ui = uiStrings(replyLang);

    // server: 中国語検索クエリ生成（失敗しても UI を沈黙させない）
    let data = null;
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/chatbot`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...(payload || {}), clientScrape: true }),
            },
            12000
        );
        data = await r.json().catch(() => null);
    } catch (_) {
        data = null;
    }

    const provider = String(payload.provider || data?.provider || 'jd').toLowerCase();
    const queries = data?.queries || [];
    const fallbackText = text;

    // JD固定
    if (provider === 'jd') {
        const usedQ = pickZhQuery(queries, fallbackText);
        console.log('[AIC] JD scrape start', { queries: data?.queries, text: payload.text });
        const s = await scrapeJdWithQueries(queries, fallbackText);
        console.log('[AIC] JD scrape done', { ok: s.ok, blocked: s.blocked, usedQuery: s.usedQuery, n: s.items?.length });

        if (s.blocked) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: 'assistant', type: 'text', content: ui.blocked },
                        {
                            role: 'assistant',
                            type: 'products',
                            items: [{
                                title: ui.openSearch,
                                url: buildJdSearchUrl(usedQ),
                                price: '',
                                image: '',
                                source: 'JD'
                            }]
                        }
                    ]
                }
            };
        }

        if (s.ok && s.items.length) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: 'assistant', type: 'text', content: `${ui.found}\n(JD keyword: ${s.usedQuery})` },
                        { role: 'assistant', type: 'products', items: s.items.slice(0, 6) },
                        { role: 'assistant', type: 'text', content: ui.refine }
                    ]
                }
            };
        }

        // サーバが死んでる/何も見つからない → 最低限 JD検索リンクを出す
        const head = data ? ui.notFound : ui.errNetwork;
        return {
            ok: true,
            data: {
                ok: true,
                reply_lang: replyLang,
                messages: [
                    { role: 'assistant', type: 'text', content: head },
                    {
                        role: 'assistant',
                        type: 'products',
                        items: [{
                            title: ui.openSearch,
                            url: buildJdSearchUrl(usedQ),
                            price: '',
                            image: '',
                            source: 'JD'
                        }]
                    },
                    { role: 'assistant', type: 'text', content: ui.refine }
                ]
            }
        };
    }

    // JD以外（今は未対応）
    return {
        ok: true,
        data: {
            ok: true,
            reply_lang: replyLang,
            messages: [{ role: 'assistant', type: 'text', content: ui.notFound }]
        }
    };
}

async function handleStt(payload = {}) {
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/stt`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload || {}),
            },
            20000
        );
        const data = await r.json().catch(() => null);
        return { ok: true, data: data || { ok: false, error: 'stt_error' } };
    } catch (e) {
        return { ok: true, data: { ok: false, error: String(e?.name || e) } };
    }
}

// side panel open behavior
chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    (async () => {
        if (msg.type === 'AI_CHAT') {
            const out = await handleAiChat(msg.payload || {});
            sendResponse(out);
            return;
        }

        if (msg.type === 'AIC_STT') {
            const out = await handleStt(msg.payload || {});
            sendResponse(out);
            return;
        }

        sendResponse({ ok: false, error: 'unknown_message_type' });
    })().catch((err) => {
        sendResponse({ ok: false, error: String(err?.message || err) });
    });

    return true;
});
