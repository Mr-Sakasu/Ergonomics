// extension/background.js (REPLACE WHOLE FILE)
// Fixes:
// - Show actual 5 Chinese search queries + per-query translations (user language) in UI
// - Keywordify display no longer becomes "あり おすすめ"; use intent anchors (PC -> "PC おすすめ")
// - Prevent category drift: if intent is confidently electronics/PC, enforce query anchors and filter results by genre
// - Profile keeps existing keys (aic_orders_v1 / aic_profile_v1)

console.log("[AIC] BG loaded (JD multi-query x5 + anchors + query list translations v5)");

const API_BASE = "https://ergonomics-mu.vercel.app/api";

// --- timeouts ---
const CHATBOT_TIMEOUT_MS = 12000;
const UIINIT_TIMEOUT_MS = 12000;
const LANGDETECT_TIMEOUT_MS = 9000;
const TRANSLATE_TIMEOUT_MS = 20000;

const SCRAPE_TIMEOUT_MS = 18000;
const ORDERS_TIMEOUT_MS = 120000;

const TOTAL_BUDGET_MS = 70000;
const QUERY_COUNT = 5;
const PER_QUERY_TAKE = 12;
const FINAL_TAKE = 5;

const ENABLE_BRIEF_ACTIVATE = false;
const BRIEF_ACTIVATE_MS = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchWithTimeout(url, options = {}, ms = 12000) {
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
        timeout: "処理がタイムアウトしました。JD側が重い/検証が出ている可能性があります。",
        redirected: "JDの検索ページに到達できませんでした（リダイレクト）。JDで一度検索できる状態か確認してください。",
        refine: "価格帯・ブランド・用途を言ってくれればさらに絞れます。",
        openSearch: "JDで検索を開く",
        queryLabel: "検索ワード",
        usedQueries: "使用した検索語",
        err: "通信に失敗しました（サーバー/ネットワーク）。",
        ordersDone: "注文履歴の取り込みが完了しました。",
        ordersNeedLogin: "JDのログインが必要です。ブラウザでJDにログインした状態で再度試してください。",
        reasonPrefix: "理由",
        reasonNoProfile: "プロフィールが未作成のため、関連度で選びました。",
        reasonNoMatch: "過去傾向との一致が少ないため、関連度・人気を優先しました。",
        reasonExplore: "探索枠：人気/定番キーワードから選びました。",
        reasonMatch: "過去の傾向と一致",
    };
    if (b === "zh") return {
        found: "找到了以下商品。",
        notFound: "这次在京东没找到，请补充更多关键词或条件。",
        blocked: "京东可能触发了验证，请先在京东页面完成验证后再试一次。",
        timeout: "处理超时了，京东页面可能很重或出现验证。",
        redirected: "无法进入京东搜索页（发生跳转）。请确认你在浏览器里能正常搜索京东。",
        refine: "告诉我预算/品牌/用途，我可以再筛选。",
        openSearch: "打开京东搜索",
        queryLabel: "搜索词",
        usedQueries: "实际使用的搜索词",
        err: "网络/服务端请求失败。",
        ordersDone: "订单历史导入完成。",
        ordersNeedLogin: "需要登录京东。请在浏览器登录后再试一次。",
        reasonPrefix: "推荐理由",
        reasonNoProfile: "个人画像尚未建立，先按相关度推荐。",
        reasonNoMatch: "与个人画像匹配较少，优先按相关度/热门度推荐。",
        reasonExplore: "探索：根据热门/经典关键词挑选。",
        reasonMatch: "符合你常买的偏好",
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
        usedQueries: "Queries used",
        err: "Network/server request failed.",
        ordersDone: "Order history import completed.",
        ordersNeedLogin: "JD login required. Please log in to JD in your browser and try again.",
        reasonPrefix: "Reason",
        reasonNoProfile: "No profile yet; ranked by relevance.",
        reasonNoMatch: "Low match to your profile; prioritized relevance/popularity.",
        reasonExplore: "Explore pick: chosen from popular/general keywords.",
        reasonMatch: "Matches your past preferences",
    };
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
function buildOrdersUrlWithJob(jobId, { maxPages = 10, maxItems = 400 } = {}) {
    const u = new URL("https://order.jd.com/center/list.action");
    u.searchParams.set("aicJob", jobId);
    u.searchParams.set("aicMaxPages", String(maxPages));
    u.searchParams.set("aicMaxItems", String(maxItems));
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
function storageGet(key) {
    return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r?.[key])));
}
function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
}

// keep existing keys so you don't lose current data
const ORDERS_KEY = "aic_orders_v1";
const PROFILE_KEY = "aic_profile_v1";

// ---------------------------
// Ensure content scripts are registered
// ---------------------------
async function ensureContentScriptsRegistered() {
    try {
        const regs = await chrome.scripting.getRegisteredContentScripts();
        const hasSearch = regs.some(r => r.id === "aic_jd_scraper");
        const hasOrders = regs.some(r => r.id === "aic_jd_orders_scraper");

        const toRegister = [];

        if (!hasSearch) {
            toRegister.push({
                id: "aic_jd_scraper",
                matches: ["https://search.jd.com/*"],
                js: ["jd_scraper.js"],
                runAt: "document_start",
                allFrames: true,
            });
        }
        if (!hasOrders) {
            toRegister.push({
                id: "aic_jd_orders_scraper",
                matches: ["https://order.jd.com/*"],
                js: ["jd_orders_scraper.js"],
                runAt: "document_start",
                allFrames: true,
            });
        }

        if (toRegister.length) {
            await chrome.scripting.registerContentScripts(toRegister);
            console.log("[AIC] registered content scripts:", toRegister.map(x => x.id));
        }
    } catch (e) {
        console.warn("[AIC] ensureContentScriptsRegistered failed:", e);
    }
}

chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel?.setPanelBehavior) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    ensureContentScriptsRegistered();
});
ensureContentScriptsRegistered();

// ---------------------------
// Pending jobs
// ---------------------------
const pendingScrapes = new Map();
const pendingOrders = new Map();

function finishJob(map, jobId, payload) {
    const p = map.get(jobId);
    if (!p) return;
    map.delete(jobId);

    try { clearTimeout(p.timer); } catch (_) { }
    try { chrome.tabs.onUpdated.removeListener(p.onUpdated); } catch (_) { }

    if (p.tabId != null) {
        try { chrome.tabs.remove(p.tabId); } catch (_) { }
    }
    try { p.resolve(payload); } catch (_) { }
}

<<<<<<< Updated upstream
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
=======
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "JD_SCRAPE_RESULT") {
        const jobId = String(msg.jobId || "");
        if (!jobId) return;
        finishJob(pendingScrapes, jobId, msg.payload || {});
        return;
    }
    if (msg?.type === "JD_ORDERS_RESULT") {
        const jobId = String(msg.jobId || "");
        if (!jobId) return;
        finishJob(pendingOrders, jobId, msg.payload || {});
        return;
    }
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
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
// Scrape JD by background tab
// ---------------------------
async function scrapeJdByTab(zhQuery, timeoutMs = SCRAPE_TIMEOUT_MS) {
    const jobId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const url = buildJdSearchUrlWithJob(zhQuery, jobId);

    const prevTabs = await pTabsQueryActive();
    const prevActiveId = prevTabs?.[0]?.id ?? null;

    const tab = await pTabsCreate({ url, active: false });

    const onUpdated = (tabId, changeInfo) => {
        if (tabId !== tab.id) return;
        if (changeInfo?.url) {
            const u = String(changeInfo.url);
            if (u.startsWith("https://www.jd.com") || u.startsWith("http://www.jd.com")) {
                finishJob(pendingScrapes, jobId, { ok: false, redirected: true, url: u });
            }
        }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    const payload = await new Promise((resolve) => {
        const timer = setTimeout(() => finishJob(pendingScrapes, jobId, { ok: false, timeout: true }), timeoutMs);
        pendingScrapes.set(jobId, { tabId: tab.id, resolve, timer, onUpdated });
    });

    if (ENABLE_BRIEF_ACTIVATE && prevActiveId != null) {
        try {
            await pTabsUpdate(tab.id, { active: true });
            await sleep(BRIEF_ACTIVATE_MS);
            await pTabsUpdate(prevActiveId, { active: true });
        } catch (_) { }
    }

    return payload;
}

async function scrapeOrdersByTab({ maxPages = 10, maxItems = 400, active = false } = {}) {
    const jobId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const url = buildOrdersUrlWithJob(jobId, { maxPages, maxItems });

    const tab = await pTabsCreate({ url, active: !!active });

    const onUpdated = (tabId, changeInfo) => {
        if (tabId !== tab.id) return;
        if (changeInfo?.url) {
            const u = String(changeInfo.url);
            if (!u.includes("order.jd.com")) {
                finishJob(pendingOrders, jobId, { ok: false, redirected: true, url: u, needLogin: true });
            }
        }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    const payload = await new Promise((resolve) => {
        const timer = setTimeout(() => finishJob(pendingOrders, jobId, { ok: false, timeout: true }), ORDERS_TIMEOUT_MS);
        pendingOrders.set(jobId, { tabId: tab.id, resolve, timer, onUpdated });
    });

    return payload;
}

// ---------------------------
// translate (optional, best-effort)
// ---------------------------
async function translateTexts(texts = [], targetLang = "en-US") {
    const arr = (texts || []).map(x => String(x || "")).filter(Boolean);
    if (!arr.length) return null;

    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/translate`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetLang, texts: arr }) },
            TRANSLATE_TIMEOUT_MS
        );
        const data = await r.json().catch(() => null);
        if (data?.ok && Array.isArray(data.translations) && data.translations.length === arr.length) {
            return data.translations.map(x => String(x || ""));
        }
    } catch (_) { }
    return null;
}

// ---------------------------
// Simple genre classifier for result filtering
// ---------------------------
function classifyGenreFromTitle(title) {
    const s = String(title || "").toLowerCase();
    if (/(thinkpad|macbook|laptop|notebook|ultra|intel|amd|ryzen|i7|i5|i9|ram|ssd|rtx|gtx|gen\d|gb|tb)/i.test(s)) return "electronics";
    if (/[手机电脑笔记本平板耳机键盘鼠标路由器硬盘内存显示器相机音箱]/.test(s)) return "electronics";
    if (/[汉堡薯条鸡肉牛肉火锅烧烤零食方便面拉面]/.test(s) || /(burger|ramen|noodle|snack)/i.test(s)) return "food";
    if (/[可乐汽水牛奶酸奶咖啡茶果汁]/.test(s) || /(cola|soda|milk|yogurt|coffee|tea|juice)/i.test(s)) return "drink";
    return "other";
}

// ---------------------------
// Intent anchors (fix drift)
// ---------------------------
function detectIntentAnchor(userQuery) {
    const s = String(userQuery || "").toLowerCase();

    // electronics / PC
    if (/(pc|パソコン|ノートpc|ノートパソコン|laptop|notebook|computer|电脑|笔记本)/i.test(s)) {
        return { genre: "electronics", confidence: 0.98, zhAnchor: "笔记本电脑", display: "PC" };
    }
    // phone
    if (/(iphone|android|smartphone|手机|スマホ)/i.test(s)) {
        return { genre: "electronics", confidence: 0.9, zhAnchor: "手机", display: "スマホ" };
    }
    // food
    if (/(ご飯|ごはん|食べ|美味|ラーメン|ハンバーガー|饭|吃|好吃|汉堡|拉面|方便面)/i.test(s)) {
        return { genre: "food", confidence: 0.85, zhAnchor: "美食", display: "ご飯" };
    }
    return { genre: "other", confidence: 0.3, zhAnchor: "", display: "" };
}

// ---------------------------
// display keywordify (fix "あり おすすめ")
// ---------------------------
function keywordifyDisplay(userQuery, replyLang) {
    const b = langBase(replyLang);
    const s0 = String(userQuery || "").trim().replace(/[。．\.!！\?？]/g, "").trim();
    if (!s0) return s0;

    const intent = detectIntentAnchor(s0);
    if (intent.confidence >= 0.9 && intent.display) {
        // PC / smartphone etc
        if (b === "ja") return `${intent.display} おすすめ`;
        if (b === "zh") return `${intent.zhAnchor || intent.display} 推荐`;
        return `${intent.display} recommendation`;
    }

    if (b === "ja") {
        // remove polite/filler and verb tails
        let x = s0
            .replace(/(おすすめ|お勧め)(の)?/g, " ")
            .replace(/(ありますか|ある|ください|教えて|欲しい|探して|探したい|です|ます|したい|お願い)/g, " ")
            .replace(/(ちなみに|とりあえず|ざっと|適当に|何か|なにか)/g, " ")
            .replace(/[がをにへでとはのからまでより]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        // drop leftover "あり"
        x = x.replace(/\bあり\b/g, "").trim();

        // pick noun-ish chunk
        const chunks = x.match(/[一-龥ぁ-んァ-ヶー]{2,}/g) || [];
        const head = chunks[0] || x || s0;

        return `${head} おすすめ`.trim();
    }

    if (b === "zh") {
        let x = s0
            .replace(/(推荐|有什么|想吃|想买|给我|请|帮我|一下|吧|呢|吗|嘛)/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const m = x.match(/[\u4E00-\u9FFF]{2,}/);
        const head = m ? m[0] : x || s0;
        return `${head} 推荐`.trim();
    }

    // english fallback
    let x = s0.toLowerCase()
        .replace(/(recommend|recommendation|suggest|something|any|please|want|i want|i'd like|show me)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const w = (x.match(/[a-z]{3,}/) || [])[0];
    const head = w || x || s0;
    return `${head} recommendation`.trim();
}

// ---------------------------
// server candidates
// ---------------------------
function pickZhCandidates(serverData) {
    const list = Array.isArray(serverData?.queries) ? serverData.queries : [];
    const zh = list
        .filter(it => String(it?.lang || "").toLowerCase().startsWith("zh"))
        .map(it => String(it?.q || "").trim())
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
// build 5 zh queries (enforce anchors if intent confident)
// ---------------------------
function buildFiveZhQueries({ serverZhList, baseZh, profile, userQuery, replyLang }) {
    const intent = detectIntentAnchor(userQuery);
    const profOK = !!(profile?.top?.length);
    const vague = /おすすめ|推荐|recommend/i.test(String(userQuery || ""));

    const out = [];
    const seen = new Set();
    const add = (q) => {
        const s = String(q || "").replace(/\s+/g, " ").trim();
        if (!s || seen.has(s)) return;
        seen.add(s);
        out.push(s);
    };

    // If intent is confidently electronics, anchor all queries with 笔记本电脑
    const anchor = intent.confidence >= 0.9 ? intent.zhAnchor : "";

    // filter server candidates by anchor when strong intent
    const serverFiltered = (serverZhList || []).filter(q => {
        if (!anchor) return true;
        return String(q).includes(anchor) || /笔记本|电脑/.test(String(q));
    });

    for (const q of serverFiltered.slice(0, 2)) add(q);

    const base = String(baseZh || "").trim() || (anchor ? anchor : "推荐");

    if (intent.confidence >= 0.9 && anchor) {
        // keep within genre strictly
        add(`${anchor} 推荐`);
        add(`${anchor} 性价比`);
        add(`${anchor} 轻薄`);
        add(`${anchor} 办公`);
        add(`${anchor} 学生`);
        return out.slice(0, QUERY_COUNT);
    }

    // otherwise: previous strategy (vague uses profile top token)
    if (vague && profOK) {
        // pick profile-biased token but do not override obvious category words
        add(`${base} 推荐`);
        add(`${base} 热销`);
        add(`${base} 性价比`);

        // small preference boost if available
        const tok = (profile.top || [])
            .map(x => String(x?.t || ""))
            .find(t => /[\u4E00-\u9FFF]/.test(t) && t.length >= 2 && t.length <= 6);
        if (tok) add(`${base} ${tok}`);
        add(`${base}`);
    } else {
        add(base);
        add(`${base} 性价比`);
        add(`${base} 热销`);
        add(`${base} 推荐`);

        if (profOK) {
            const tok = (profile.top || [])
                .map(x => String(x?.t || ""))
                .find(t => /[\u4E00-\u9FFF]/.test(t) && t.length >= 2 && t.length <= 6);
            if (tok) add(`${base} ${tok}`);
        }
    }

    // ensure size
    return out.slice(0, QUERY_COUNT);
}

// ---------------------------
// Pooling / ranking / reasons
// ---------------------------
function dedupeByKey(items) {
    const out = [];
    const seen = new Set();
    for (const it of items || []) {
        const key =
            (it?.sku ? `sku:${it.sku}` : "") ||
            (it?.url ? `url:${it.url}` : "") ||
            (it?.title ? `t:${it.title}` : "");
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
    }
    return out;
}

function normalizeForMatch(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[（）()【】\[\]{}<>《》"“”'‘’·•.,，。:：;；!?！？\-_/\\|｜]+/g, "");
}

function scoreWithProfile(title, profile) {
    if (!profile?.top?.length) return { score: 0, matches: [] };
    const tNorm = normalizeForMatch(title);
    if (!tNorm) return { score: 0, matches: [] };

    let score = 0;
    const matches = [];

    for (const { t, c } of profile.top) {
        const tok = String(t || "").trim();
        if (!tok) continue;
        const tokNorm = normalizeForMatch(tok);
        if (!tokNorm) continue;

        if (tNorm.includes(tokNorm)) {
            matches.push(tok);
            score += (c || 1);
            if (matches.length >= 3) break;
        }
    }
    return { score, matches };
}

function reasonText(ui, profile, matches, isExplore) {
    const hasProfile = !!(profile?.top?.length);
    if (matches && matches.length) {
        const joined = matches.join(langBase(ui?.reasonPrefix) === "zh" ? "、" : ", ");
        return `${ui.reasonPrefix}: ${ui.reasonMatch}（${joined}）`;
    }
    if (!hasProfile) return `${ui.reasonPrefix}: ${ui.reasonNoProfile}`;
    return `${ui.reasonPrefix}: ${isExplore ? ui.reasonExplore : ui.reasonNoMatch}`;
}

async function rankAndExplain(poolItems, profile, replyLang) {
    const ui = uiStrings(replyLang);

    const scored = (poolItems || []).map((x, idx) => {
        const { score, matches } = scoreWithProfile(x?.title, profile);
        return { x, idx, score, matches };
    });

    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

    // diversity: best per query first
    const bestByQuery = new Map();
    for (const row of scored) {
        const q = String(row?.x?._fromQuery || "");
        if (!q) continue;
        if (!bestByQuery.has(q)) bestByQuery.set(q, row);
        if (bestByQuery.size >= QUERY_COUNT) break;
    }

    const final = [];
    const seen = new Set();

    function keyOf(it) {
        return (it?.sku ? `sku:${it.sku}` : "") || (it?.url ? `url:${it.url}` : "") || (it?.title ? `t:${it.title}` : "");
    }

    for (const row of bestByQuery.values()) {
        const it = row.x;
        const k = keyOf(it);
        if (!k || seen.has(k)) continue;

        const fromQ = String(it?._fromQuery || "");
        const isExplore = /性价比|热销|评价好/.test(fromQ) && !(row?.matches?.length);

        final.push({
            title: it.title,
            description: reasonText(ui, profile, row.matches, isExplore),
            price: it.price,
            image: it.image,
            url: it.url,
            source: "JD",
        });
        seen.add(k);
        if (final.length >= FINAL_TAKE) break;
    }

    for (const row of scored) {
        if (final.length >= FINAL_TAKE) break;
        const it = row.x;
        const k = keyOf(it);
        if (!k || seen.has(k)) continue;

        const fromQ = String(it?._fromQuery || "");
        const isExplore = /性价比|热销|评价好/.test(fromQ) && !(row?.matches?.length);

        final.push({
            title: it.title,
            description: reasonText(ui, profile, row.matches, isExplore),
            price: it.price,
            image: it.image,
            url: it.url,
            source: "JD",
        });
        seen.add(k);
    }

    return final;
}

// ---------------------------
// UI init + Lang detect handlers
// ---------------------------
async function handleUiInit(payload = {}) {
    const lang = payload.lang || "en-US";
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
    const defaultLang = payload.defaultLang || "en-US";
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
// Main handler: AI_CHAT
// ---------------------------
async function handleAiChat(payload = {}) {
    const replyLang = payload.lang || "en-US";
    const ui = uiStrings(replyLang);
    const t0 = Date.now();

    const fullText = String(payload.text || "").trim();
    const userQuery = extractUserQueryText(fullText) || fullText;

    const profile = (await storageGet(PROFILE_KEY)) || { top: [] };

    // server base planner
    let serverData = null;
    try {
        const r = await fetchWithTimeout(
            `${API_BASE}/chatbot`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(payload || {}), clientScrape: true }) },
            CHATBOT_TIMEOUT_MS
        );
        serverData = await r.json().catch(() => null);
    } catch (_) {
        serverData = null;
    }

    const serverZh = pickZhCandidates(serverData);
    const baseZh = serverZh[0] || String(serverData?.keyword_zh || "").trim() || userQuery;

    // Display label (fixed)
    const displayRaw = pickDisplayQuery(serverData, userQuery);
    const displayLabel = keywordifyDisplay(displayRaw, replyLang);

    // 5 queries
    const zhQueries = buildFiveZhQueries({
        serverZhList: serverZh,
        baseZh,
        profile,
        userQuery,
        replyLang,
    });

    // Translate queries for display (per your requirement)
    let zhTranslations = null;
    if (langBase(replyLang) !== "zh") {
        zhTranslations = await translateTexts(zhQueries, replyLang);
    }

    const usedQueriesText = (() => {
        const lines = [];
        lines.push(`${ui.usedQueries}:`);
        for (let i = 0; i < zhQueries.length; i++) {
            const zhQ = zhQueries[i];
            const tr = zhTranslations?.[i];
            if (tr && tr.trim() && tr.trim() !== zhQ.trim()) {
                lines.push(`${i + 1}) ${tr.trim()}  ←  ${zhQ}`);
            } else {
                lines.push(`${i + 1}) ${zhQ}`);
            }
        }
        return lines.join("\n");
    })();

    // scrape pool
    const pool = [];
    let anyBlocked = false, anyRedirected = false, anyTimeout = false;

    const intent = detectIntentAnchor(userQuery);

    for (const zhQ of zhQueries) {
        if (Date.now() - t0 > TOTAL_BUDGET_MS) break;

        const r = await scrapeJdByTab(zhQ, SCRAPE_TIMEOUT_MS).catch((e) => ({ ok: false, error: String(e?.message || e) }));

        if (r?.blocked) { anyBlocked = true; continue; }
        if (r?.redirected) { anyRedirected = true; continue; }
        if (r?.timeout) { anyTimeout = true; continue; }

        if (r?.ok && Array.isArray(r.items) && r.items.length > 0) {
            const items = r.items.slice(0, PER_QUERY_TAKE).map((it) => ({
                title: String(it.title || ""),
                description: "",
                price: String(it.price || ""),
                image: String(it.image || ""),
                url: String(it.url || ""),
                sku: String(it.sku || ""),
                source: "JD",
                _fromQuery: zhQ,
            }));

            // ✅ prevent category drift: if intent is confidently electronics, filter non-electronics items
            if (intent.confidence >= 0.9 && intent.genre === "electronics") {
                for (const x of items) {
                    const g = classifyGenreFromTitle(x.title);
                    if (g === "electronics" || g === "other") pool.push(x);
                }
            } else {
                pool.push(...items);
            }
        }
    }

    if (!pool.length) {
        const openQ = zhQueries[0] || baseZh || userQuery;
        const openSearchItem = { title: ui.openSearch, url: buildJdSearchUrl(openQ), price: "", image: "", source: "JD" };

        const commonMsgs = [
            { role: "assistant", type: "text", content: `(${ui.queryLabel}: ${displayLabel})` },
            { role: "assistant", type: "text", content: usedQueriesText },
            { role: "assistant", type: "products", items: [openSearchItem] },
        ];

        if (anyBlocked) return { ok: true, data: { ok: true, reply
