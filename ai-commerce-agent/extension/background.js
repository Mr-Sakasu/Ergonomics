// extension/background.js (REPLACE WHOLE FILE)
// Fix: exec_timeout is not fatal -> retry.
// Fix: create JD search tab as ACTIVE while scraping (then restore).
// Fix: use querySelector instead of querySelectorAll counting (much faster).

console.log("[AIC] BG loaded (JD scrape v8 - retry exec_timeout)");

const API_BASE = "https://ergonomics-mu.vercel.app/api";

const CHATBOT_TIMEOUT_MS = 4500;

// Total budget for one request
const TOTAL_BUDGET_MS = 30000;

// executeScript timeout (only for one call)
const EXEC_TIMEOUT_MS = 15000;

// How long we keep waiting for cards (overall)
const WAIT_CARDS_MS = 20000;

// How many queries to try (each query => new tab)
const MAX_QUERY_TRIES = 1;

// IMPORTANT: make the created search tab ACTIVE while scraping, then restore.
const SCRAPE_TAB_ACTIVE = true;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchWithTimeout(url, options = {}, ms = 8000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function langBase(lang = "") {
    const s = String(lang || "").toLowerCase();
    return s.split(/[-_]/)[0] || "en";
}
function uiStrings(userLang = "en-US") {
    const b = langBase(userLang);
    if (b === "ja") return {
        found: "以下が見つかりました。",
        notFound: "すみません、JD内で見つかりませんでした。キーワードや条件を少し変えてみてください。",
        blocked: "JD側で検証が出た可能性があります。JDのページで一度検証してからもう一度試してください。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。",
        openSearch: "JDで検索を開く",
        timeout: "処理がタイムアウトしました。もう一度試してください（JD側が重い/検証が出ている可能性）。",
        err: "通信に失敗しました（サーバー/ネットワーク）。",
    };
    if (b === "zh") return {
        found: "找到了以下商品。",
        notFound: "这次在京东没找到，请补充更多关键词或条件。",
        blocked: "京东可能触发了验证，请先在京东页面完成验证后再试一次。",
        refine: "告诉我预算/品牌/用途，我可以再筛选。",
        openSearch: "打开京东搜索",
        timeout: "处理超时了，请再试一次（京东页面可能很重或出现验证）。",
        err: "网络/服务端请求失败。",
    };
    return {
        found: "Here are the products I found.",
        notFound: "I couldn’t find it on JD this time. Please add more keywords or constraints.",
        blocked: "JD may have shown a verification step. Please open JD, complete verification, then try again.",
        refine: "Tell me budget/brand/use case to refine.",
        openSearch: "Open JD search",
        timeout: "Timed out. Please try again (JD may be heavy or showing verification).",
        err: "Network/server request failed.",
    };
}

function buildJdSearchUrl(q) {
    return `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}&enc=utf-8`;
}

function extractUserQueryText(fullText) {
    const s = String(fullText || "").trim();
    if (!s) return "";
    const parts = s.split(/\n\s*\[PageContext\]/i);
    return (parts[0] || "").trim();
}

function isHostPermissionError(err) {
    const m = String(err?.message || err || "");
    return /Cannot access contents of url|must request permission to access this host|Missing host permission/i.test(m);
}
function isTabGoneError(err) {
    const m = String(err?.message || err || "");
    return /No tab with id|tab was closed|The tab was closed/i.test(m);
}

function withTimeout(promise, ms, tag = "timeout") {
    let t;
    const timer = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(tag)), ms);
    });
    return Promise.race([promise, timer]).finally(() => clearTimeout(t));
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
function pTabsUpdate(tabId, props) {
    return new Promise((resolve) => chrome.tabs.update(tabId, props, () => resolve(true)));
}
function pTabsQueryActive() {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(Array.isArray(tabs) ? tabs : []);
        });
    });
}

function pExecuteScript(details) {
    return new Promise((resolve, reject) => {
        chrome.scripting.executeScript(
            { ...details, injectImmediately: true }, // ← これが本命
            (results) => {
                const err = chrome.runtime.lastError;
                if (err) reject(err);
                else resolve(results || []);
            }
        );
    });
}



async function exec(tabId, func, args = [], ms = EXEC_TIMEOUT_MS) {
    const pending = pExecuteScript({ target: { tabId }, func, args });

    // debug: if it resolves late, log it
    const started = Date.now();
    pending.then(() => {
        const dt = Date.now() - started;
        if (dt > ms) console.log("[AIC] exec resolved late", { dt });
    }).catch(() => { /* ignore */ });

    try {
        const rs = await withTimeout(pending, ms, "exec_timeout");
        return { ok: true, result: rs?.[0]?.result };
    } catch (e) {
        if (String(e?.message || e) === "exec_timeout") return { ok: false, error: "exec_timeout" };
        if (isHostPermissionError(e)) return { ok: false, error: "NO_HOST_PERMISSION", detail: String(e?.message || e) };
        if (isTabGoneError(e)) return { ok: false, error: "TAB_GONE", detail: String(e?.message || e) };
        return { ok: false, error: String(e?.message || e) };
    }
}

async function waitForCards(tabId, timeoutMs = WAIT_CARDS_MS) {
    const start = Date.now();
    let lastLog = 0;

    // selectors tuned for your DOM:
    // - new: plugin_goodsCardWrapper + data-sku OR data-point-id+data-sku
    const SEL_NEW = '[data-point-id][data-sku], .plugin_goodsCardWrapper[data-sku], .goodsCardWrapper[data-sku]';
    const SEL_OLD = '#J_goodsList li.gl-item[data-sku], li.gl-item[data-sku]';

    while (Date.now() - start < timeoutMs) {
        const r = await exec(
            tabId,
            (selNew, selOld) => {
                const hasNew = !!document.querySelector(selNew);
                const hasOld = !!document.querySelector(selOld);

                const bodyText = (document.body?.innerText || "").slice(0, 1200);
                const blocked = /验证|安全验证|captcha|访问过于频繁/i.test(bodyText) && !hasNew && !hasOld;

                const host = location.hostname;
                const href = location.href;
                const redirectedToHome = host === "www.jd.com" && !href.includes("search.jd.com/Search");

                return {
                    hasNew, hasOld, blocked, host, href,
                    redirectedToHome,
                    readyState: document.readyState
                };
            },
            [SEL_NEW, SEL_OLD]
        );

        // ✅ ここが重要：exec_timeout は「失敗」ではなく「遅いだけ」なので待って再試行
        if (!r.ok) {
            if (r.error === "exec_timeout") {
                if (Date.now() - lastLog > 2500) {
                    console.log("[AIC] waitForCards: exec_timeout (retrying)");
                    lastLog = Date.now();
                }
                await sleep(500);
                continue;
            }
            return r; // NO_HOST_PERMISSION / TAB_GONE などは即終了
        }

        const rr = r.result || {};
        if (Date.now() - lastLog > 2500) {
            console.log("[AIC] waitForCards", { hasNew: rr.hasNew, hasOld: rr.hasOld, readyState: rr.readyState, host: rr.host });
            lastLog = Date.now();
        }

        if (rr.blocked) return { ok: true, blocked: true, ready: false };
        if (rr.redirectedToHome) return { ok: true, redirected: true, ready: false };
        if (rr.hasNew || rr.hasOld) return { ok: true, blocked: false, ready: true };

        await sleep(600);
    }

    return { ok: true, blocked: false, ready: false };
}

async function scrapeFromTab(tabId, limit = 6) {
    const SEL_NEW = '[data-point-id][data-sku], .plugin_goodsCardWrapper[data-sku], .goodsCardWrapper[data-sku]';
    const SEL_OLD = '#J_goodsList li.gl-item[data-sku], li.gl-item[data-sku]';

    // If this times out once, retry once more
    for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await exec(
            tabId,
            (LIMIT, selNew, selOld) => {
                const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
                const normUrl = (u) => {
                    const s = clean(u);
                    if (!s) return "";
                    if (s.startsWith("//")) return `https:${s}`;
                    if (s.startsWith("http://") || s.startsWith("https://")) return s;
                    return s;
                };

                // prefer new DOM first
                let cards = Array.from(document.querySelectorAll(selNew));
                let used = "new";
                if (!cards.length) {
                    cards = Array.from(document.querySelectorAll(selOld));
                    used = "old";
                }

                // minimal scroll to trigger lazy images
                try { window.scrollTo(0, 900); } catch (_) { }

                const items = [];
                const seen = new Set();

                const pickTitle = (root) => {
                    const ts = Array.from(root.querySelectorAll("[title]"))
                        .map((el) => clean(el.getAttribute("title")))
                        .filter(Boolean);
                    ts.sort((a, b) => b.length - a.length);
                    return ts[0] || clean(root.textContent).slice(0, 90);
                };

                for (const card of cards) {
                    if (items.length >= LIMIT) break;

                    const sku = clean(card.getAttribute("data-sku"));
                    if (!sku || seen.has(sku)) continue;

                    // skip ad blocks
                    if (card.querySelector('[class*="_ad_"],[class*="ad_"],[class*="广告"]')) continue;

                    const title = pickTitle(card);
                    if (!title) continue;

                    let href =
                        normUrl(card.querySelector('a[href*="item.jd.com"]')?.getAttribute("href")) ||
                        normUrl(card.querySelector('a[href*="item.m.jd.com"]')?.getAttribute("href")) ||
                        normUrl(card.querySelector("a[href]")?.getAttribute("href"));
                    if (!href || !href.includes("jd.com")) href = `https://item.jd.com/${sku}.html`;

                    const img = card.querySelector("img");
                    const image = normUrl(
                        img?.getAttribute("data-src") ||
                        img?.getAttribute("data-lazy-img") ||
                        img?.getAttribute("data-original") ||
                        img?.getAttribute("src")
                    );

                    items.push({ sku, title, url: href, image, price: "", source: "JD" });
                    seen.add(sku);
                }

                return { used, got: items.length, items };
            },
            [Number(limit || 6), SEL_NEW, SEL_OLD]
        );

        if (!r.ok && r.error === "exec_timeout" && attempt === 1) {
            console.log("[AIC] scrapeFromTab: exec_timeout -> retrying once");
            await sleep(800);
            continue;
        }

        return r;
    }

    return { ok: false, error: "exec_timeout" };
}

async function fetchJdPrices(skus = []) {
    const list = (skus || []).filter(Boolean).slice(0, 20);
    const map = new Map();
    if (!list.length) return map;

    const skuIds = list.map((id) => `J_${id}`).join(",");
    const url = `https://p.3.cn/prices/mgets?skuIds=${encodeURIComponent(skuIds)}&type=1`;

    try {
        const r = await fetchWithTimeout(
            url,
            { headers: { Accept: "application/json,text/plain,*/*", Referer: "https://search.jd.com/" } },
            5000
        );
        const arr = await r.json().catch(() => null);
        if (Array.isArray(arr)) {
            for (const row of arr) {
                const id = String(row?.id || "").replace(/^J_/, "");
                const p = row?.p || row?.op || row?.m || "";
                if (id) map.set(id, p ? String(p) : "");
            }
        }
    } catch (_) { }
    return map;
}

async function scrapeJdSearchOnce(query, limit = 6) {
    const url = buildJdSearchUrl(query);

    const prevTabs = await pTabsQueryActive();
    const prevActiveId = prevTabs?.[0]?.id || null;

    // ✅ IMPORTANT: open tab active to avoid background throttling
    const tab = await pTabsCreate({ url, active: SCRAPE_TAB_ACTIVE });
    console.log("[AIC] created tab", { tabId: tab.id, url, active: SCRAPE_TAB_ACTIVE });

    const killTimer = setTimeout(() => {
        try { chrome.tabs.remove(tab.id); } catch (_) { }
    }, 35000);

    try {
        // Instead of relying on tab.status events, just wait for cards with retries.
        const w = await waitForCards(tab.id, WAIT_CARDS_MS);
        if (!w.ok) return w;
        if (w.blocked) return { ok: true, blocked: true, items: [] };
        if (w.redirected) return { ok: true, redirected: true, items: [] };
        if (!w.ready) return { ok: true, items: [] };

        const s = await scrapeFromTab(tab.id, limit);
        if (!s.ok) return s;

        console.log("[AIC] scrapeFromTab", { used: s.result?.used, got: s.result?.got });

        const items0 = (s.result?.items || []).slice(0, limit);

        // price fill
        const needSku = items0.map((it) => it.sku).filter(Boolean);
        const priceMap = await fetchJdPrices(needSku);

        const items = items0.map((it) => {
            const p = priceMap.get(it.sku) || "";
            const price = p ? (p.includes("￥") ? p : `￥${p}`) : "";
            return { ...it, price };
        });

        return { ok: true, blocked: false, items, usedQuery: query };
    } finally {
        clearTimeout(killTimer);
        try { await pTabsRemove(tab.id); } catch (_) { }
        if (prevActiveId && SCRAPE_TAB_ACTIVE) {
            try { await pTabsUpdate(prevActiveId, { active: true }); } catch (_) { }
        }
    }
}

function buildCandidates(queriesFromServer, fallback) {
    const list = Array.isArray(queriesFromServer) ? queriesFromServer : [];
    const picked = [];

    for (const it of list) {
        const lang = String(it?.lang || "").toLowerCase();
        const q = String(it?.q || "").trim();
        if (q && lang.startsWith("zh")) picked.push(q);
    }
    for (const it of list) {
        const q = String(it?.q || "").trim();
        if (q) picked.push(q);
    }
    if (fallback) picked.push(fallback);

    const out = [];
    const seen = new Set();
    for (const q of picked) {
        const k = q.trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(k);
    }
    return out;
}

async function handleAiChat(payload = {}) {
    const replyLang = payload.lang || "ja-JP";
    const ui = uiStrings(replyLang);

    const t0 = Date.now();
    const fullText = String(payload.text || "").trim();
    const userQuery = extractUserQueryText(fullText) || fullText;

    console.log("[AIC] AI_CHAT start", { userQuery });

    // server: query variants (optional)
    let serverData = null;
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/chatbot`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...(payload || {}), clientScrape: true }),
            },
            CHATBOT_TIMEOUT_MS
        );
        serverData = await r.json().catch(() => null);
    } catch (_) {
        serverData = null;
    }

    const candidates = buildCandidates(serverData?.queries, userQuery);
    console.log("[AIC] candidates", candidates);

    for (const q of candidates.slice(0, MAX_QUERY_TRIES)) {
        const elapsed = Date.now() - t0;
        if (elapsed > TOTAL_BUDGET_MS) break;

        console.log("[AIC] scrape try", { q });

        const r = await withTimeout(
            scrapeJdSearchOnce(q, 6),
            Math.max(8000, TOTAL_BUDGET_MS - elapsed),
            "total_budget_timeout"
        ).catch((e) => ({ ok: false, error: String(e?.message || e) }));

        console.log("[AIC] scrape done", { q, ok: r?.ok, err: r?.error, blocked: r?.blocked, n: r?.items?.length });

        if (String(r?.error || "").includes("total_budget_timeout")) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: ui.timeout },
                        { role: "assistant", type: "products", items: [{ title: ui.openSearch, url: buildJdSearchUrl(q), price: "", image: "", source: "JD" }] },
                    ],
                },
            };
        }

        if (r?.blocked) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: ui.blocked },
                        { role: "assistant", type: "products", items: [{ title: ui.openSearch, url: buildJdSearchUrl(q), price: "", image: "", source: "JD" }] },
                    ],
                },
            };
        }

        if (r?.ok && Array.isArray(r.items) && r.items.length > 0) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: `${ui.found}\n(JD keyword: ${q})` },
                        { role: "assistant", type: "products", items: r.items.slice(0, 6) },
                        { role: "assistant", type: "text", content: ui.refine },
                    ],
                },
            };
        }
    }

    const openQ = candidates[0] || userQuery;
    return {
        ok: true,
        data: {
            ok: true,
            reply_lang: replyLang,
            messages: [
                { role: "assistant", type: "text", content: serverData ? ui.notFound : ui.err },
                { role: "assistant", type: "products", items: [{ title: ui.openSearch, url: buildJdSearchUrl(openQ), price: "", image: "", source: "JD" }] },
                { role: "assistant", type: "text", content: ui.refine },
            ],
        },
    };
}

// side panel open behavior
chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
});

// ===== Port only =====
function safePortPost(port, msg) {
    try { port.postMessage(msg); } catch (e) { console.warn("[AIC] port.postMessage failed", e); }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "aic") return;
    console.log("[AIC] port connected");

    port.onMessage.addListener(async (msg) => {
        const type = msg?.type;
        const jobId = msg?.jobId;
        const payload = msg?.payload || {};
        if (!type || !jobId) return;

        try {
            if (type === "AI_CHAT") {
                const out = await handleAiChat(payload);
                safePortPost(port, { type: "AI_CHAT_RESULT", jobId, out });
                return;
            }
            safePortPost(port, { type: "AIC_ERROR", jobId, error: "unknown_type" });
        } catch (e) {
            safePortPost(port, { type: "AIC_ERROR", jobId, error: String(e?.message || e) });
        }
    });
});
