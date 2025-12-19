// extension/background.js
console.log('[AIC] BG loaded');

const API_BASE = 'https://ergonomics-mu.vercel.app/api';
const DEFAULT_TIMEOUT_MS = 12000;

function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeScriptErrorMessage(msg = '') {
    const s = String(msg || '');
    if (s.includes('Cannot access a chrome:// URL')) return 'restricted_chrome_url';
    if (s.includes('The extensions gallery cannot be scripted')) return 'restricted_webstore';
    if (s.includes('Cannot access contents of the page')) return 'cannot_access_page';
    if (s.includes('Extension manifest must request permission')) return 'missing_host_permission';
    return s || 'unknown_error';
}

// ---- Promisify chrome.* (安定動作用) ----
function pTabsQuery(queryInfo) {
    return new Promise((resolve) => chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || [])));
}
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
function pExecuteScript(details) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(details, (results) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(results || []);
        });
    });
}

async function waitTabComplete(tabId, timeoutMs = 14000) {
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

function langBase(lang = '') {
    const s = String(lang || '').toLowerCase();
    return s.split(/[-_]/)[0] || 'en';
}
function uiStrings(userLang = 'en-US') {
    const b = langBase(userLang);
    if (b === 'ja') return {
        found: '以下が見つかりました。',
        notFound: 'すみません、今回は見つかりませんでした。キーワードや条件を少し変えてみてください。',
        blocked: 'JD側で検証が出た可能性があります。JDのページで一度検索/検証してからもう一度試してください。',
        refine: '予算・ブランド・用途を言ってくれればさらに絞れます。',
        openSearch: 'JDで検索を開く',
    };
    if (b === 'zh') return {
        found: '找到了以下商品。',
        notFound: '这次没有找到，请再补充一点关键词或条件。',
        blocked: '京东可能触发了验证。请先在京东页面完成验证后再试一次。',
        refine: '说下预算/品牌/用途，我可以再筛选。',
        openSearch: '打开京东搜索',
    };
    return {
        found: 'Here are the products I found.',
        notFound: 'I couldn’t find it this time. Please add more keywords or constraints.',
        blocked: 'JD may have shown a verification step. Please open JD, complete verification, then try again.',
        refine: 'Tell me budget/brand/use case to refine.',
        openSearch: 'Open JD search',
    };
}

function buildJdSearchUrl(q) {
    return `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}&enc=utf-8`;
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
        await waitTabComplete(tab.id, 14000);
        await sleep(700);

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
                    if (s.startsWith('/')) return `https://item.jd.com${s}`;
                    return s;
                };

                const bodyText = (document.body?.innerText || '').slice(0, 2000);
                const blocked =
                    /验证|安全验证|captcha|访问过于频繁/i.test(bodyText) &&
                    !document.querySelector('#J_goodsList');

                const raw = [];
                const nodes = Array.from(document.querySelectorAll('#J_goodsList li.gl-item'));
                for (const li of nodes) {
                    if (raw.length >= LIMIT * 3) break;

                    const sku = clean(li.getAttribute('data-sku'));
                    const title =
                        clean(li.querySelector('.p-name em')?.textContent) ||
                        clean(li.querySelector('.p-name')?.textContent);

                    const a = li.querySelector('.p-name a');
                    const itemUrl = normUrl(a?.getAttribute('href'));

                    const img = li.querySelector('.p-img img');
                    const imgUrl = normUrl(
                        img?.getAttribute('data-lazy-img') ||
                        img?.getAttribute('data-lazy-img-slave') ||
                        img?.getAttribute('src')
                    );

                    const priceText = clean(li.querySelector('.p-price i')?.textContent);
                    const shopName = clean(li.querySelector('.p-shop a')?.textContent);
                    const badge = clean(li.querySelector('.p-icons i')?.textContent);

                    raw.push({ sku, title, url: itemUrl, image: imgUrl, priceText, shopName, badge });
                }

                const seen = new Set();
                const items = [];
                for (const it of raw) {
                    const key = it.sku ? `sku:${it.sku}` : `url:${it.url}`;
                    if (!it.title || !it.url || seen.has(key)) continue;
                    seen.add(key);
                    items.push(it);
                    if (items.length >= LIMIT) break;
                }

                return { blocked, items };
            },
        });

        const r0 = results?.[0]?.result || { blocked: false, items: [] };
        const items0 = Array.isArray(r0.items) ? r0.items : [];
        const blocked = !!r0.blocked;

        const skusNeed = items0.filter((it) => it?.sku && !it?.priceText).map((it) => it.sku);
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

        return { ok: true, blocked, items: out };
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
    // 1) サーバに「中国語検索キーワード生成」だけ依頼
    const r = await fetchWithTimeout(`${API_BASE}/chatbot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(payload || {}), clientScrape: true }),
    }, 12000);

    const data = await r.json().catch(() => null);
    if (!data || data.ok === false) {
        return { ok: true, data: { ok: false, error: data?.error || 'chatbot_error' } };
    }

    const replyLang = data.reply_lang || payload.lang || 'en-US';
    const ui = uiStrings(replyLang);

    const provider = String(data.provider || payload.provider || '').toLowerCase();
    const isJdMode = provider === 'jd' || String(payload.siteHost || '').includes('jd.com');

    if (isJdMode) {
        const queries = data.queries || [];
        const fallbackText = String(payload.text || '').split('[PageContext]')[0]?.trim() || '';
        const usedQ = pickZhQuery(queries, fallbackText);

        const s = await scrapeJdWithQueries(queries, fallbackText);

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
                        { role: 'assistant', type: 'text', content: ui.refine },
                    ]
                }
            };
        }

        return {
            ok: true,
            data: {
                ok: true,
                reply_lang: replyLang,
                messages: [
                    { role: 'assistant', type: 'text', content: ui.notFound },
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
                    { role: 'assistant', type: 'text', content: ui.refine },
                ]
            }
        };
    }

    // JD以外は（今は）サーバ結果をそのまま返す/無ければNotFound
    if (Array.isArray(data.messages)) return { ok: true, data };
    return { ok: true, data: { ok: true, reply_lang: replyLang, messages: [{ role: 'assistant', type: 'text', content: ui.notFound }] } };
}

async function handleStt(payload = {}) {
    const r = await fetchWithTimeout(`${API_BASE}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
    }, 20000);
    const data = await r.json().catch(() => null);
    return { ok: true, data: data || { ok: false, error: 'stt_error' } };
}

// side panel open behavior
chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    // Voice: forward injected result to all extension contexts
    if (msg.type === 'AIC_VOICE_RESULT') {
        if (msg._forwarded) return;
        chrome.runtime.sendMessage({ ...msg, _forwarded: true });
        return;
    }

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

        // 既存: lang detect（必要なら）
        if (msg.type === 'AIC_DETECT_LANG') {
            const r = await fetchWithTimeout(`${API_BASE}/lang-detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: msg.text || '' }),
            }, 8000);
            const data = await r.json().catch(() => null);
            sendResponse({ ok: true, data });
            return;
        }

        // 既存: voice start/stop（そのまま）
        if (msg.type === 'AIC_VOICE_START') {
            const { tabId, maxMs = 6000, sessionId = '' } = msg.payload || {};
            if (!tabId) { sendResponse({ ok: false, error: 'tabId_missing' }); return; }

            chrome.scripting.executeScript(
                {
                    target: { tabId },
                    args: [Number(maxMs || 6000), String(sessionId || '')],
                    func: async (MAX_MS, SESSION) => {
                        const sendResult = (payload) => {
                            try {
                                chrome.runtime.sendMessage({
                                    type: 'AIC_VOICE_RESULT',
                                    sessionId: SESSION,
                                    siteHost: location.hostname || '',
                                    pageUrl: location.href || '',
                                    title: document.title || '',
                                    ...payload,
                                });
                            } catch (_) { }
                        };

                        const blobToBase64 = async (blob) =>
                            await new Promise((resolve, reject) => {
                                const fr = new FileReader();
                                fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
                                fr.onerror = reject;
                                fr.readAsDataURL(blob);
                            });

                        const cleanup = () => {
                            try {
                                if (globalThis.__aicVoice?.stream) {
                                    globalThis.__aicVoice.stream.getTracks().forEach((t) => t.stop());
                                }
                            } catch (_) { }
                            globalThis.__aicVoice = null;
                        };

                        if (globalThis.__aicVoice && globalThis.__aicVoice.state === 'recording') {
                            return { ok: true, already: true };
                        }

                        try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                            const recorder = new MediaRecorder(stream);
                            const chunks = [];

                            globalThis.__aicVoice = {
                                state: 'recording',
                                recorder,
                                stream,
                                stop: () => {
                                    try { if (recorder.state === 'recording') recorder.stop(); } catch (_) { }
                                },
                            };

                            recorder.ondataavailable = (ev) => {
                                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
                            };

                            recorder.onerror = () => {
                                sendResult({ ok: false, error: 'recorder_error' });
                                cleanup();
                            };

                            recorder.onstop = async () => {
                                try {
                                    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                                    const audioBase64 = await blobToBase64(blob);
                                    sendResult({ ok: true, audioBase64, mimeType: blob.type || 'audio/webm' });
                                } catch (e) {
                                    sendResult({ ok: false, error: String(e?.name || e) });
                                } finally {
                                    cleanup();
                                }
                            };

                            recorder.start();
                            setTimeout(() => {
                                try { if (globalThis.__aicVoice?.recorder?.state === 'recording') globalThis.__aicVoice.stop(); } catch (_) { }
                            }, MAX_MS);

                            return { ok: true };
                        } catch (e) {
                            sendResult({ ok: false, error: String(e?.name || e) });
                            cleanup();
                            return { ok: false, error: String(e?.name || e) };
                        }
                    },
                },
                (results) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ ok: false, error: normalizeScriptErrorMessage(chrome.runtime.lastError.message) });
                        return;
                    }
                    sendResponse({ ok: true, data: results?.[0]?.result || {} });
                }
            );
            return;
        }

        if (msg.type === 'AIC_VOICE_STOP') {
            const { tabId } = msg.payload || {};
            if (!tabId) { sendResponse({ ok: false, error: 'tabId_missing' }); return; }

            chrome.scripting.executeScript(
                {
                    target: { tabId },
                    func: () => {
                        try {
                            if (globalThis.__aicVoice?.stop) {
                                globalThis.__aicVoice.stop();
                                return { ok: true };
                            }
                            return { ok: true, noRecorder: true };
                        } catch (e) {
                            return { ok: false, error: String(e?.name || e) };
                        }
                    },
                },
                (results) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ ok: false, error: normalizeScriptErrorMessage(chrome.runtime.lastError.message) });
                        return;
                    }
                    sendResponse({ ok: true, data: results?.[0]?.result || {} });
                }
            );
            return;
        }

        sendResponse({ ok: false, error: 'unknown_message_type' });
    })().catch((err) => {
        sendResponse({ ok: false, error: String(err?.message || err) });
    });

    return true;
});
