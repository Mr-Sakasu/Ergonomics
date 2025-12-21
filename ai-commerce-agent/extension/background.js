// extension/background.js (REPLACE WHOLE FILE)
// JD-only search via background tab + content script (jd_scraper.js)
// + AIC_UI_INIT + AIC_LANG_DETECT
// Fix: Accept ANY input language; if payload.lang is wrong, re-detect locally via chrome.i18n.detectLanguage.

console.log("[AIC] BG loaded (JD scrape via content script v4 + chrome detectLanguage)");

const API_BASE = "https://ergonomics-mu.vercel.app/api";

// --- timeouts ---
const CHATBOT_TIMEOUT_MS = 12000;
const UIINIT_TIMEOUT_MS = 12000;
const LANGDETECT_TIMEOUT_MS = 9000;

const SCRAPE_TIMEOUT_MS = 20000;
const TOTAL_BUDGET_MS = 30000;
const MAX_QUERY_TRIES = 2;

const ENABLE_BRIEF_ACTIVATE = false;
const BRIEF_ACTIVATE_MS = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchWithTimeout(url, options = {}, ms = 12000) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort("timeout"), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

function langBase(lang = "") {
    const s = String(lang || "").trim();
    if (!s) return "en";
    return s.toLowerCase().split(/[-_]/)[0] || "en";
}

function normalizeLangTag(lang) {
    const s = String(lang || "").trim();
    if (!s) return "en-US";
    if (/^zh[-_](cn|tw|hk)$/i.test(s)) {
        const [a, b] = s.split(/[-_]/);
        return `${a.toLowerCase()}-${b.toUpperCase()}`;
    }
    if (/^[a-z]{2}$/i.test(s)) {
        const b = s.toLowerCase();
        if (b === "en") return "en-US";
        if (b === "ja") return "ja-JP";
        if (b === "zh") return "zh-CN";
        if (b === "ko") return "ko-KR";
        return b;
    }
    const parts = s.split(/[-_]/);
    if (parts.length === 1) return parts[0].toLowerCase();
    return parts
        .map((p, i) => {
            if (i === 0) return p.toLowerCase();
            if (p.length === 2) return p.toUpperCase();
            if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase();
            return p;
        })
        .join("-");
}

// ----- fallback strings (still used if your /ui-init does not provide these keys) -----
function uiStringsFallback(userLang = "en-US") {
    const b = langBase(userLang);
    if (b === "ja")
        return {
            found: "以下が見つかりました。",
            notFound: "すみません、JD内で見つかりませんでした。キーワードや条件を少し変えてみてください。",
            blocked: "JD側で検証が出た可能性があります。JDのページで一度検証してからもう一度試してください。",
            timeout: "処理がタイムアウトしました。JD側が重い/検証が出ている可能性があります。",
            redirected: "JDの検索ページに到達できませんでした（リダイレクト）。JDで一度検索できる状態か確認してください。",
            refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。",
            openSearch: "JDで検索を開く",
            queryLabel: "検索ワード",
            err: "通信に失敗しました（サーバー/ネットワーク）。",
        };
    if (b === "zh")
        return {
            found: "找到了以下商品。",
            notFound: "这次在京东没找到，请补充更多关键词或条件。",
            blocked: "京东可能触发了验证，请先在京东页面完成验证后再试一次。",
            timeout: "处理超时了，京东页面可能很重或出现验证。",
            redirected: "无法进入京东搜索页（发生跳转）。请确认你在浏览器里能正常搜索京东。",
            refine: "告诉我预算/品牌/用途，我可以再筛选。",
            openSearch: "打开京东搜索",
            queryLabel: "搜索词",
            err: "网络/服务端请求失败。",
        };
    return {
        found: "Here are the products I found.",
        notFound: "I couldn’t find it on JD this time. Please add more keywords or constraints.",
        blocked: "JD may have shown a verification step. Please open JD, complete verification, then try again.",
        timeout: "Timed out. JD may be heavy or showing verification.",
        redirected: "Couldn’t reach JD search page (redirected). Please make sure JD search works in your browser.",
        refine: "Tell me budget/brand/use case to refine.",
        openSearch: "Open JD search",
        queryLabel: "Query",
        err: "Network/server request failed.",
    };
}

// OPTIONAL: if /ui-init returns extra keys (found/refine/...), we use them.
const uiTextCache = new Map(); // lang -> pack
async function getUiTextPack(lang) {
    const L = normalizeLangTag(lang);
    if (uiTextCache.has(L)) return uiTextCache.get(L);

    const fallback = uiStringsFallback(L);
    let remote = null;
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/ui-init`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang: L }) },
            UIINIT_TIMEOUT_MS
        );
        remote = await r.json().catch(() => null);
    } catch (_) {
        remote = null;
    }

    // remote may or may not include these keys; merge safely
    const pack = {
        // existing fields that sidepanel uses (keep them too)
        lang: normalizeLangTag(remote?.lang || L),
        welcome: remote?.welcome || "",
        placeholder: remote?.placeholder || "",
        open_button: remote?.open_button || "Open",
        no_image: remote?.no_image || "No image",
        searching: remote?.searching || "🔎 Searching…",

        // text fields used in background
        found: remote?.found || fallback.found,
        notFound: remote?.notFound || fallback.notFound,
        blocked: remote?.blocked || fallback.blocked,
        timeout: remote?.timeout || fallback.timeout,
        redirected: remote?.redirected || fallback.redirected,
        refine: remote?.refine || fallback.refine,
        openSearch: remote?.openSearch || fallback.openSearch,
        queryLabel: remote?.queryLabel || fallback.queryLabel,
        err: remote?.err || fallback.err,
    };

    uiTextCache.set(pack.lang, pack);
    return pack;
}

// Local language detection (ANY language) using chrome.i18n.detectLanguage
function detectLangByChrome(text) {
    return new Promise((resolve) => {
        try {
            if (!chrome?.i18n?.detectLanguage) return resolve(null);
            chrome.i18n.detectLanguage(String(text || ""), (res) => {
                const err = chrome.runtime?.lastError;
                if (err || !res) return resolve(null);

                const langs = Array.isArray(res.languages) ? res.languages : [];
                langs.sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
                const best = langs.find((x) => x?.language && x.language !== "und" && (x.percentage || 0) >= 20);
                if (!best?.language) return resolve(null);
                resolve(normalizeLangTag(best.language));
            });
        } catch (_) {
            resolve(null);
        }
    });
}

function buildJdSearchUrl(q) {
    return `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}&enc=utf-8`;
}

function buildJdSearchUrlWithJob(q, jobId) {
    const u = new URL("https://search.jd.com/Search");
    u.searchParams.set("keyword", q);
    u.searchParams.set("enc", "utf-8");
    u.searchParams.set("aicJob", jobId);
    return u.toString();
}

function extractUserQueryText(fullText) {
    const s = String(fullText || "").trim();
    if (!s) return "";
    const parts = s.split(/\n\s*\[PageContext\]/i);
    return (parts[0] || "").trim();
}

function normalizeDisplayQuery(s) {
    return String(s || "")
        .replace(/[、，,。．・/／|｜]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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

// ---------------------------
// Ensure jd_scraper.js is registered (safety net)
// ---------------------------
async function ensureContentScriptRegistered() {
    try {
        const regs = await chrome.scripting.getRegisteredContentScripts();
        const has = regs.some((r) => r.id === "aic_jd_scraper");
        if (has) return;

        await chrome.scripting.registerContentScripts([
            {
                id: "aic_jd_scraper",
                matches: ["https://search.jd.com/*"],
                js: ["jd_scraper.js"],
                runAt: "document_start",
                allFrames: true,
            },
        ]);

        console.log("[AIC] registered content script: aic_jd_scraper");
    } catch (e) {
        console.warn("[AIC] ensureContentScriptRegistered failed:", e);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    ensureContentScriptRegistered();
});
ensureContentScriptRegistered();

// ---------------------------
// Pending scrape jobs
// ---------------------------
const pendingScrapes = new Map(); // jobId -> { tabId, resolve, timer, onUpdated }

function finishScrape(jobId, payload) {
    const p = pendingScrapes.get(jobId);
    if (!p) return;

    pendingScrapes.delete(jobId);

    try {
        clearTimeout(p.timer);
    } catch (_) { }
    try {
        chrome.tabs.onUpdated.removeListener(p.onUpdated);
    } catch (_) { }

    if (p.tabId != null) {
        try {
            chrome.tabs.remove(p.tabId);
        } catch (_) { }
    }

    try {
        p.resolve(payload);
    } catch (_) { }
}

// NOTE: This listener serves TWO purposes:
//  1) Receive JD_SCRAPE_RESULT from jd_scraper.js (content script)
//  2) Serve sidepanel RPC via sendMessage (MV3-friendly; SW can sleep/wake)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // (1) content script -> background
    if (msg?.type === "JD_SCRAPE_RESULT") {
        const jobId = String(msg.jobId || "");
        if (!jobId) return;

        const payload = msg.payload || {};
        console.log("[AIC] JD_SCRAPE_RESULT received", { jobId, ok: payload?.ok, n: payload?.items?.length });

        finishScrape(jobId, payload);
        return;
    }

    // (2) sidepanel -> background (single-shot RPC)
    const type = msg?.type;
    const payload = msg?.payload || {};
    if (!type) return;

    (async () => {
        try {
            if (type === "AIC_UI_INIT") return sendResponse(await handleUiInit(payload));
            if (type === "AIC_LANG_DETECT") return sendResponse(await handleLangDetect(payload));
            if (type === "AI_CHAT") return sendResponse(await handleAiChat(payload));
            if (type === "AIC_STT") return sendResponse(await handleStt(payload));

            sendResponse({ ok: false, error: "unknown_type" });
        } catch (e) {
            sendResponse({ ok: false, error: String(e?.message || e) });
        }
    })();

    // keep the message channel open for async sendResponse
    return true;
});

// ---------------------------
// Price fill (optional)
// ---------------------------
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
            6000
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

// ---------------------------
// Scrape JD by background tab + content script
// ---------------------------
async function scrapeJdByTab(zhQuery, timeoutMs = SCRAPE_TIMEOUT_MS) {
    const jobId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const url = buildJdSearchUrlWithJob(zhQuery, jobId);

    const prevTabs = await pTabsQueryActive();
    const prevActiveId = prevTabs?.[0]?.id ?? null;

    const tab = await pTabsCreate({ url, active: false });
    console.log("[AIC] created search tab", { tabId: tab.id, jobId, url });

    const onUpdated = (tabId, changeInfo) => {
        if (tabId !== tab.id) return;
        if (changeInfo?.url) {
            const u = String(changeInfo.url);
            if (u.startsWith("https://www.jd.com") || u.startsWith("http://www.jd.com")) {
                console.log("[AIC] redirected away from search.jd.com", { jobId, url: u });
                finishScrape(jobId, { ok: false, redirected: true, url: u });
            }
        }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    const payload = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            finishScrape(jobId, { ok: false, timeout: true });
        }, timeoutMs);

        pendingScrapes.set(jobId, {
            tabId: tab.id,
            resolve,
            timer,
            onUpdated,
        });
    });

    if (ENABLE_BRIEF_ACTIVATE && prevActiveId != null) {
        try {
            await pTabsUpdate(tab.id, { active: true });
            await sleep(BRIEF_ACTIVATE_MS);
            await pTabsUpdate(prevActiveId, { active: true });
        } catch (_) { }
    }

    if (payload?.ok && Array.isArray(payload.items) && payload.items.length > 0) {
        const need = payload.items.filter((it) => !it.price).map((it) => it.sku).filter(Boolean);
        if (need.length) {
            const priceMap = await fetchJdPrices(need);
            payload.items = payload.items.map((it) => {
                const p = it.price || priceMap.get(it.sku) || "";
                const price = p ? (String(p).includes("￥") ? String(p) : `￥${p}`) : "";
                return { ...it, price };
            });
        }
    }

    return payload;
}

// ---------------------------
// UI init + Lang detect handlers (server)
// ---------------------------
async function handleUiInit(payload = {}) {
    const lang = normalizeLangTag(payload.lang || "en-US");
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/ui-init`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang }) },
            UIINIT_TIMEOUT_MS
        );
        const data = await r.json().catch(() => null);
        return { ok: true, data: data || { ok: false } };
    } catch (e) {
        return { ok: true, data: { ok: false, error: String(e?.name || e) } };
    }
}

async function handleLangDetect(payload = {}) {
    const text = String(payload.text || "");
    const defaultLang = normalizeLangTag(payload.defaultLang || "en-US");
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/lang-detect`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, defaultLang }) },
            LANGDETECT_TIMEOUT_MS
        );
        const data = await r.json().catch(() => null);
        return { ok: true, data: data || { ok: false, lang: defaultLang } };
    } catch (e) {
        return { ok: true, data: { ok: true, lang: defaultLang, error: String(e?.name || e) } };
    }
}

// ---------------------------
// pick candidates
// ---------------------------
function pickZhCandidates(serverData) {
    const list = Array.isArray(serverData?.queries) ? serverData.queries : [];
    const zh = list
        .filter((it) => String(it?.lang || "").toLowerCase().startsWith("zh"))
        .map((it) => String(it?.q || "").trim())
        .filter(Boolean);

    const keywordZh = String(serverData?.keyword_zh || "").trim();
    const merged = [...zh, keywordZh].filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const q of merged) {
        const k = q.trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(k);
    }
    return out;
}

function pickDisplayQuery(serverData, fallbackUserQuery) {
    const dq = String(serverData?.display_query || "").trim();
    return normalizeDisplayQuery(dq || fallbackUserQuery || "");
}

// ---------------------------
// Main handler: AI_CHAT
// ---------------------------
async function handleAiChat(payload = {}) {
    const t0 = Date.now();

    const fullText = String(payload.text || "").trim();
    const userQuery = extractUserQueryText(fullText) || fullText;

    // Prefer payload.lang from sidepanel, but guard against wrong fallback ("en-US")
    let replyLang = normalizeLangTag(payload.lang || "en-US");
    const chromeDetected = await detectLangByChrome(userQuery);
    if (chromeDetected && langBase(chromeDetected) !== langBase(replyLang)) {
        // if sidepanel was wrong, fix here
        replyLang = chromeDetected;
    }

    const ui = await getUiTextPack(replyLang);

    console.log("[AIC] AI_CHAT start", { userQuery, replyLang });

    // 1) server generates queries + display_query
    let serverData = null;
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/chatbot`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...(payload || {}), lang: replyLang, clientScrape: true }),
            },
            CHATBOT_TIMEOUT_MS
        );
        serverData = await r.json().catch(() => null);
    } catch (e) {
        console.log("[AIC] /chatbot failed (ok)", String(e?.name || e));
        serverData = null;
    }

    const displayQuery = pickDisplayQuery(serverData, userQuery);
    const zhCandidates = pickZhCandidates(serverData);

    console.log("[AIC] displayQuery", displayQuery);
    console.log("[AIC] zhCandidates", zhCandidates);

    // 2) scraping
    for (const zhQ of zhCandidates.slice(0, MAX_QUERY_TRIES)) {
        if (Date.now() - t0 > TOTAL_BUDGET_MS) break;

        console.log("[AIC] scrape try", { zhQ });

        const r = await scrapeJdByTab(zhQ, SCRAPE_TIMEOUT_MS).catch((e) => ({
            ok: false,
            error: String(e?.message || e),
        }));

        console.log("[AIC] scrape done", {
            zhQ,
            ok: r?.ok,
            blocked: r?.blocked,
            timeout: r?.timeout,
            redirected: r?.redirected,
            n: r?.items?.length,
        });

        const openSearchItem = {
            title: ui.openSearch,
            url: buildJdSearchUrl(zhQ),
            price: "",
            image: "",
            source: "JD",
        };

        if (r?.blocked) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: ui.blocked },
                        { role: "assistant", type: "text", content: `(${ui.queryLabel}: ${displayQuery})` },
                        { role: "assistant", type: "products", items: [openSearchItem] },
                    ],
                },
            };
        }

        if (r?.redirected) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: ui.redirected },
                        { role: "assistant", type: "text", content: `(${ui.queryLabel}: ${displayQuery})` },
                        { role: "assistant", type: "products", items: [openSearchItem] },
                    ],
                },
            };
        }

        if (r?.timeout) {
            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: ui.timeout },
                        { role: "assistant", type: "text", content: `(${ui.queryLabel}: ${displayQuery})` },
                        { role: "assistant", type: "products", items: [openSearchItem] },
                    ],
                },
            };
        }

        if (r?.ok && Array.isArray(r.items) && r.items.length > 0) {
            // 5 items only
            const items = r.items.slice(0, 5).map((it) => ({
                title: String(it.title || ""),
                description: "",
                price: String(it.price || ""),
                image: String(it.image || ""),
                url: String(it.url || ""),
                source: "JD",
            }));

            return {
                ok: true,
                data: {
                    ok: true,
                    reply_lang: replyLang,
                    messages: [
                        { role: "assistant", type: "text", content: `${ui.found}\n(${ui.queryLabel}: ${displayQuery})` },
                        { role: "assistant", type: "products", items },
                        { role: "assistant", type: "text", content: ui.refine },
                    ],
                },
            };
        }
    }

    // Not found
    const openQ = zhCandidates[0] || userQuery;
    return {
        ok: true,
        data: {
            ok: true,
            reply_lang: replyLang,
            messages: [
                { role: "assistant", type: "text", content: serverData ? ui.notFound : ui.err },
                { role: "assistant", type: "text", content: `(${ui.queryLabel}: ${displayQuery})` },
                { role: "assistant", type: "products", items: [{ title: ui.openSearch, url: buildJdSearchUrl(openQ), price: "", image: "", source: "JD" }] },
                { role: "assistant", type: "text", content: ui.refine },
            ],
        },
    };
}

// ---------------------------
// STT handler (unchanged)
// ---------------------------
async function handleStt(payload = {}) {
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/stt`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) },
            20000
        );
        const data = await r.json().catch(() => null);
        return { ok: true, data: data || { ok: false, error: "stt_error" } };
    } catch (e) {
        return { ok: true, data: { ok: false, error: String(e?.name || e) } };
    }
}

// ===== Port messaging =====
function safePortPost(port, msg) {
    try {
        port.postMessage(msg);
    } catch (e) {
        console.warn("[AIC] port.postMessage failed", e);
    }
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
            if (type === "AIC_UI_INIT") {
                const out = await handleUiInit(payload);
                safePortPost(port, { type: "AIC_UI_INIT_RESULT", jobId, out });
                return;
            }
            if (type === "AIC_LANG_DETECT") {
                const out = await handleLangDetect(payload);
                safePortPost(port, { type: "AIC_LANG_DETECT_RESULT", jobId, out });
                return;
            }
            if (type === "AI_CHAT") {
                const out = await handleAiChat(payload);
                safePortPost(port, { type: "AI_CHAT_RESULT", jobId, out });
                return;
            }
            if (type === "AIC_STT") {
                const out = await handleStt(payload);
                safePortPost(port, { type: "AIC_STT_RESULT", jobId, out });
                return;
            }
            safePortPost(port, { type: "AIC_ERROR", jobId, error: "unknown_type" });
        } catch (e) {
            safePortPost(port, { type: "AIC_ERROR", jobId, error: String(e?.message || e) });
        }
    });

    port.onDisconnect.addListener(() => {
        console.log("[AIC] port disconnected", chrome.runtime.lastError?.message || "");
    });
});
