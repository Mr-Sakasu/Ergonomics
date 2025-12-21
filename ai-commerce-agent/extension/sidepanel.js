// extension/sidepanel.js (REPLACE WHOLE FILE)
// - Header buttons: #btnSync / #btnProfile
// - Profile modal: vertical genre charts (all time + last30d), top tokens (all + last30d), sample titles
// - Translate tokens/titles to user language via AIC_TRANSLATE (needs API_BASE /translate; fallback to original)
// - Token display count configurable (default >=3)
// - Port keepalive + reconnect, language detect, search, voice

console.log("[AIC] sidepanel.js loaded");

let el = null;

<<<<<<< Updated upstream
function addBubble(text, who = "bot") {
    if (!el?.msgs) return null;
    const div = document.createElement("div");
    div.className = `bubble ${who === "me" ? "me" : "bot"}`;
    div.textContent = String(text || "");
    el.msgs.appendChild(div);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return div;
}

// ===== Background通信 (MV3 Service Worker 対応) =====
//
// MV3のService Workerは「何もしていないと勝手に停止」します。
// Port(connect) を張りっぱなしにすると、停止時に port が切れて
// 「Connection to background process was lost」になりがちです。
//
// そこで sidepanel -> background は sendMessage(単発RPC) に変更します。
// sendMessage は必要な時に Service Worker を自動で起動してくれるので、
// 放置しても壊れにくいです。

function requestBG(type, payload, timeoutMs = 120000) {
=======
// =========================
// Port (auto reconnect + keepalive)
// =========================
let port = null;
let keepAliveTimer = null;
let reconnecting = false;
const pending = new Map();

function connectPort() {
    if (port) return;
    try {
        port = chrome.runtime.connect({ name: "aic" });
    } catch (_) {
        port = null;
        return;
    }

    port.onMessage.addListener((msg) => {
        if (msg?.type === "AIC_PONG") return;

        const jobId = msg?.jobId;
        if (!jobId) return;

        const p = pending.get(jobId);
        if (!p) return;
        pending.delete(jobId);

        p.resolve(msg.out);
    });

    port.onDisconnect.addListener(() => {
        for (const [jobId, p] of pending.entries()) {
            try { p.reject(new Error("port_disconnected")); } catch (_) { }
            pending.delete(jobId);
        }
        stopKeepAlive();
        port = null;

        if (!reconnecting) {
            reconnecting = true;
            setTimeout(() => {
                reconnecting = false;
                connectPort();
            }, 600);
        }
    });

    startKeepAlive();
}

function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
        try { port?.postMessage({ type: "AIC_PING" }); } catch (_) { }
    }, 5000);
}

function stopKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
}

function requestPort(type, payload, timeoutMs = 120000) {
    connectPort();
    if (!port) return Promise.reject(new Error("port_unavailable"));

    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

>>>>>>> Stashed changes
    return new Promise((resolve, reject) => {
        let done = false;

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error("timeout"));
        }, timeoutMs);

<<<<<<< Updated upstream
=======
        pending.set(jobId, {
            resolve: (v) => { clearTimeout(t); resolve(v); },
            reject: (e) => { clearTimeout(t); reject(e); },
        });

>>>>>>> Stashed changes
        try {
            chrome.runtime.sendMessage({ type, payload }, (resp) => {
                if (done) return;
                done = true;
                clearTimeout(timer);

                const err = chrome.runtime?.lastError;
                if (err) return reject(new Error(err.message || "sendMessage_error"));
                resolve(resp);
            });
        } catch (e) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(e);
        }
    });
}

// =========================
// UI helpers + local i18n
// =========================
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
    return parts.map((p, i) => {
        if (i === 0) return p.toLowerCase();
        if (p.length === 2) return p.toUpperCase();
        if (p.length === 4) return p[0].toUpperCase() + p.slice(1).toLowerCase();
        return p;
    }).join("-");
}

function getDefaultUiLang() {
    try {
        const l = chrome.i18n?.getUILanguage?.();
        if (l) return normalizeLangTag(l);
    } catch (_) { }
    return normalizeLangTag(navigator.language || "en-US");
}

function t(key) {
    const b = langBase(ui?.lang || getDefaultUiLang());
    const JA = {
        profile: "プロフィール",
        refresh: "更新",
        close: "閉じる",
        orders: "注文数",
        ordersUpdated: "注文更新",
        profileUpdated: "プロフィール更新",
        tokenWhat: "tokens ＝ 注文タイトルから抽出したキーワード（推薦/一致判定に使用）",
        filterTokens: "トークンを絞り込み…",
        showCount: "表示件数",
        genresAll: "ジャンル（全期間）",
        genres30: "ジャンル（直近30日）",
        topAll: "Top tokens（全期間）",
        top30: "Top tokens（直近30日）",
        samples: "注文タイトル例",
        syncStart: "⏳ 注文履歴を同期中…",
        syncDone: "✅ 同期完了",
        syncFail: "同期に失敗しました",
        noData: "データがありません（Sync後、注文日時が取れていれば直近が出ます）。",
        genre_food: "食品",
        genre_drink: "飲料",
        genre_electronics: "家電/デジタル",
        genre_beauty: "美容",
        genre_home: "日用品/生活",
        genre_apparel: "衣類",
        genre_baby: "ベビー",
        genre_sports: "スポーツ",
        genre_books: "書籍",
        genre_office: "オフィス",
        genre_pet: "ペット",
        genre_other: "その他",
    };
    const ZH = {
        profile: "个人画像",
        refresh: "刷新",
        close: "关闭",
        orders: "订单数",
        ordersUpdated: "订单更新时间",
        profileUpdated: "画像更新时间",
        tokenWhat: "tokens＝从订单标题提取的关键词（用于匹配/推荐）",
        filterTokens: "筛选关键词…",
        showCount: "显示数量",
        genresAll: "分类（全量）",
        genres30: "分类（近30天）",
        topAll: "Top tokens（全量）",
        top30: "Top tokens（近30天）",
        samples: "订单标题示例",
        syncStart: "⏳ 正在同步订单历史…",
        syncDone: "✅ 同步完成",
        syncFail: "同步失败",
        noData: "暂无数据（Sync后若能获取到下单时间，近30天数据会显示）。",
        genre_food: "食品",
        genre_drink: "饮料",
        genre_electronics: "数码家电",
        genre_beauty: "美妆护肤",
        genre_home: "家居日用",
        genre_apparel: "服饰",
        genre_baby: "母婴",
        genre_sports: "运动",
        genre_books: "图书",
        genre_office: "办公",
        genre_pet: "宠物",
        genre_other: "其他",
    };
    const EN = {
        profile: "Profile",
        refresh: "Refresh",
        close: "Close",
        orders: "Orders",
        ordersUpdated: "Orders updated",
        profileUpdated: "Profile updated",
        tokenWhat: "tokens = keywords extracted from order titles (used for matching/recommendation)",
        filterTokens: "Filter tokens…",
        showCount: "Show",
        genresAll: "Genres (all time)",
        genres30: "Genres (last 30d)",
        topAll: "Top tokens (all time)",
        top30: "Top tokens (last 30d)",
        samples: "Sample order titles",
        syncStart: "⏳ Syncing order history…",
        syncDone: "✅ Sync done",
        syncFail: "Sync failed",
        noData: "No data (needs order timestamps for recent windows).",
        genre_food: "Food",
        genre_drink: "Drinks",
        genre_electronics: "Electronics",
        genre_beauty: "Beauty",
        genre_home: "Home",
        genre_apparel: "Apparel",
        genre_baby: "Baby",
        genre_sports: "Sports",
        genre_books: "Books",
        genre_office: "Office",
        genre_pet: "Pets",
        genre_other: "Other",
    };

    const dict = b === "ja" ? JA : b === "zh" ? ZH : EN;
    return dict[key] || key;
}

function genreName(id) {
    return t(`genre_${id}`);
}

function fmtTime(ms) {
    if (!ms) return "-";
    try { return new Date(ms).toLocaleString(); } catch (_) { return String(ms); }
}

function addBubble(text, who = "bot") {
    if (!el?.msgs) return null;
    const div = document.createElement("div");
    div.className = `bubble ${who === "me" ? "me" : "bot"}`;
    div.textContent = String(text || "");
    el.msgs.appendChild(div);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return div;
}

// =========================
// UI pack (from server)
// =========================
const uiCache = new Map();
let ui = {
    lang: "en-US",
    welcome: "",
    placeholder: "",
    open_button: "Open",
    no_image: "No image",
    searching: "🔎 Searching…",
};

async function ensureUiPack(lang, { showWelcome = false, setPlaceholder = true } = {}) {
    const norm = normalizeLangTag(lang);
    const key = `aic_ui_pack_v3_${norm}`;

    if (uiCache.has(norm)) {
        ui = uiCache.get(norm);
        if (setPlaceholder && ui.placeholder && el?.inp) el.inp.placeholder = ui.placeholder;
        if (showWelcome && ui.welcome) addBubble(ui.welcome, "bot");
        return ui;
    }

    try {
        const cached = localStorage.getItem(key);
        if (cached) {
            const j = JSON.parse(cached);
            if (j?.lang && j?.open_button) {
                uiCache.set(norm, j);
                ui = j;
                if (setPlaceholder && ui.placeholder && el?.inp) el.inp.placeholder = ui.placeholder;
                if (showWelcome && ui.welcome) addBubble(ui.welcome, "bot");
                return ui;
            }
        }
    } catch (_) { }

<<<<<<< Updated upstream
    // fetch via background -> /api/ui-init
    const out = await requestBG("AIC_UI_INIT", { lang: norm }, 120000);
=======
    const out = await requestPort("AIC_UI_INIT", { lang: norm }, 120000);
>>>>>>> Stashed changes
    const data = out?.data;

    if (data?.ok) {
        const pack = {
            lang: normalizeLangTag(data.lang || norm),
            welcome: data.welcome || "",
            placeholder: data.placeholder || "",
            open_button: data.open_button || "Open",
            no_image: data.no_image || "No image",
            searching: data.searching || "🔎 Searching…",
        };
        uiCache.set(pack.lang, pack);
        ui = pack;

        try { localStorage.setItem(`aic_ui_pack_v3_${pack.lang}`, JSON.stringify(pack)); } catch (_) { }

        if (setPlaceholder && pack.placeholder && el?.inp) el.inp.placeholder = pack.placeholder;
        if (showWelcome && pack.welcome) addBubble(pack.welcome, "bot");
        return pack;
    }

    ui = { ...ui, lang: norm };
    return ui;
}

// =========================
// Language detect
// =========================
function detectLangByChromeWithTimeout(text, timeoutMs = 700) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v) => {
            if (done) return;
            done = true;
            resolve(v);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);

        try {
            if (!chrome?.i18n?.detectLanguage) {
                clearTimeout(timer);
                return finish(null);
            }
            chrome.i18n.detectLanguage(String(text || ""), (res) => {
                clearTimeout(timer);
                const err = chrome.runtime?.lastError;
                if (err || !res) return finish(null);

                const langs = Array.isArray(res.languages) ? res.languages : [];
                langs.sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
                const best = langs.find((x) => x?.language && x.language !== "und" && (x.percentage || 0) >= 20);
                if (!best?.language) return finish(null);
                finish(normalizeLangTag(best.language));
            });
        } catch (_) {
            clearTimeout(timer);
            finish(null);
        }
    });
}

async function detectLangRemote(text, defaultLang) {
    try {
        const out = await requestBG("AIC_LANG_DETECT", { text, defaultLang }, 120000);
        return normalizeLangTag(out?.data?.lang || defaultLang || "en-US");
    } catch (_) {
        return normalizeLangTag(defaultLang || "en-US");
    }
}

async function detectLangSmart(text, defaultLang) {
    const def = normalizeLangTag(defaultLang || "en-US");
    const local = await detectLangByChromeWithTimeout(text, 700);
    if (local) return local;
    return await detectLangRemote(text, def);
}

// =========================
// Products renderer
// =========================
function addProducts(items = []) {
    if (!el?.msgs) return;

    const wrap = document.createElement("div");
    wrap.className = "products";

    for (const it of items) {
        const card = document.createElement("div");
        card.className = "card";

        const thumb = document.createElement("div");
        thumb.className = "thumb";

        if (it.image) {
            const img = document.createElement("img");
            img.src = it.image;
            img.alt = it.title || "";
            thumb.appendChild(img);
        } else {
            thumb.textContent = ui.no_image || "No image";
        }

        const meta = document.createElement("div");
        meta.className = "meta";

        const tEl = document.createElement("div");
        tEl.className = "t";
        tEl.textContent = it.title || "";

        const dEl = document.createElement("div");
        dEl.className = "d";
        dEl.textContent = it.description || "";

        const pEl = document.createElement("div");
        pEl.className = "p";
        pEl.textContent =
            `${it.price || ""}${it.source ? ` · ${it.source}` : ""}`.trim() ||
            (it.source ? `· ${it.source}` : "");

        meta.appendChild(tEl);
        if (it.description) meta.appendChild(dEl);
        meta.appendChild(pEl);

        const open = document.createElement("button");
        open.className = "open";
        open.textContent = ui.open_button || "Open";
        open.onclick = () => {
            if (!it.url) return;
            chrome.tabs.create({ url: it.url });
        };

        card.appendChild(thumb);
        card.appendChild(meta);
        card.appendChild(open);

        wrap.appendChild(card);
    }

    el.msgs.appendChild(wrap);
    el.msgs.scrollTop = el.msgs.scrollHeight;
}

// =========================
// Profile modal UI
// =========================
let overlay = null;
let overlayContent = null;

// display limits (user can change)
let showN = 6; // default >= 3

function injectProfileStylesOnce() {
    if (document.getElementById("aic-profile-style")) return;
    const st = document.createElement("style");
    st.id = "aic-profile-style";
    st.textContent = `
    .aic-overlay{ position: fixed; inset:0; z-index:10000; background: rgba(0,0,0,0.55); display:none; align-items: stretch; justify-content: stretch; }
    .aic-modal{ margin:10px; border-radius: 16px; background: rgba(20,20,20,0.95); border:1px solid rgba(255,255,255,0.10); overflow:hidden; display:flex; flex-direction:column; width: calc(100% - 20px); }
    .aic-modal-hd{ display:flex; align-items:center; justify-content: space-between; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10); gap: 8px; }
    .aic-modal-hd .title{ font-weight:700; font-size:13px; }
    .aic-modal-bd{ padding:12px; overflow:auto; flex:1; }
    .aic-mini-btn{ width:auto !important; height:28px !important; padding:0 10px !important; font-size:12px !important; border-radius:10px !important; border:1px solid rgba(255,255,255,0.14) !important; background: rgba(255,255,255,0.06) !important; color: inherit !important; cursor:pointer !important; }
    .aic-mini-btn:hover{ background: rgba(255,255,255,0.10) !important; }
    .aic-kv{ display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 10px; opacity:0.92; }
    .aic-pill{ border:1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); padding:6px 10px; border-radius:999px; font-size:12px; }
    .aic-section{ margin-top: 12px; }
    .aic-section h4{ margin: 8px 0; font-size: 13px; opacity:0.9; }
    .aic-bars{ display:flex; flex-direction: column; gap:6px; }
    .aic-bar-row{ display:grid; grid-template-columns: 1fr 4fr auto; gap:8px; align-items:center; }
    .aic-bar-label{ font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.95; }
    .aic-bar{ height:10px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow:hidden; }
    .aic-bar-fill{ height:100%; background: rgba(255,255,255,0.35); width:0%; }
    .aic-bar-count{ font-size:12px; opacity:0.8; }
    .aic-small{ font-size:12px; opacity:0.85; white-space: pre-wrap; }
    .aic-input{ width:100%; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: inherit; outline:none; margin: 8px 0 0; font-size: 12px; }
    .aic-row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .aic-select{ height:28px; border-radius:10px; border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.06); color:inherit; padding: 0 8px; font-size:12px; }
  `;
    document.head.appendChild(st);
}

function ensureOverlay() {
    injectProfileStylesOnce();
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "aic-overlay";

    const modal = document.createElement("div");
    modal.className = "aic-modal";

    const hd = document.createElement("div");
    hd.className = "aic-modal-hd";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t("profile");

    const actions = document.createElement("div");
    actions.className = "aic-row";

    // Show count selector
    const label = document.createElement("div");
    label.className = "aic-small";
    label.textContent = `${t("showCount")}:`;

    const sel = document.createElement("select");
    sel.className = "aic-select";
    for (const n of [3, 5, 6, 10, 15]) {
        const opt = document.createElement("option");
        opt.value = String(n);
        opt.textContent = String(n);
        if (n === showN) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
        showN = Number(sel.value || 6);
        // refresh modal contents with same cached data if present
        if (lastProfileData) renderProfile(lastProfileData);
    });

    const btnRefresh = document.createElement("button");
    btnRefresh.className = "aic-mini-btn";
    btnRefresh.textContent = t("refresh");
    btnRefresh.onclick = () => openProfileModal(true);

    const btnClose = document.createElement("button");
    btnClose.className = "aic-mini-btn";
    btnClose.textContent = t("close");
    btnClose.onclick = closeOverlay;

    actions.appendChild(label);
    actions.appendChild(sel);
    actions.appendChild(btnRefresh);
    actions.appendChild(btnClose);

    hd.appendChild(title);
    hd.appendChild(actions);

    overlayContent = document.createElement("div");
    overlayContent.className = "aic-modal-bd";
    overlayContent.textContent = "Loading…";

    modal.appendChild(hd);
    modal.appendChild(overlayContent);
    overlay.appendChild(modal);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeOverlay();
    });

    document.body.appendChild(overlay);
}

function showOverlay() {
    ensureOverlay();
    overlay.style.display = "flex";
}
function closeOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
}

function renderBars(container, rows, { isGenre = false } = {}) {
    container.innerHTML = "";
    const arr = Array.isArray(rows) ? rows : [];
    if (!arr.length) {
        const empty = document.createElement("div");
        empty.className = "aic-small";
        empty.textContent = t("noData");
        container.appendChild(empty);
        return;
    }

    const max = Math.max(1, ...arr.map(x => Number(x.count || x.c || 0)));
    for (const x of arr) {
        const labelText = isGenre ? genreName(x.id) : String(x.t || "");
        const countVal = Number(x.count || x.c || 0);

        const row = document.createElement("div");
        row.className = "aic-bar-row";

        const label = document.createElement("div");
        label.className = "aic-bar-label";
        label.title = labelText;
        label.textContent = labelText;

        const bar = document.createElement("div");
        bar.className = "aic-bar";
        const fill = document.createElement("div");
        fill.className = "aic-bar-fill";
        fill.style.width = `${Math.max(0, Math.min(100, (countVal / max) * 100))}%`;
        bar.appendChild(fill);

        const count = document.createElement("div");
        count.className = "aic-bar-count";
        count.textContent = String(countVal);

        row.appendChild(label);
        row.appendChild(bar);
        row.appendChild(count);
        container.appendChild(row);
    }
}

async function fetchProfile() {
    const out = await requestPort("AIC_GET_PROFILE", {}, 60000);
    return out?.data;
}

async function translateBulk(texts, targetLang) {
    const out = await requestPort("AIC_TRANSLATE", { texts, targetLang }, 120000);
    const d = out?.data;
    if (d?.ok && Array.isArray(d.translations)) return d.translations;
    return null;
}

let lastProfileData = null;

async function openProfileModal(forceRefresh = false) {
    showOverlay();
    if (overlayContent) overlayContent.textContent = "Loading…";

    try {
        const d = await fetchProfile();
        lastProfileData = d;
        await renderProfile(d);
    } catch (e) {
        if (overlayContent) overlayContent.textContent = `Profile error:\n${String(e?.message || e)}`;
    }
}

async function renderProfile(data) {
    if (!overlayContent) return;

    if (!data?.ok) {
        overlayContent.textContent = "Failed to load profile.";
        return;
    }

    const ordersCount = data.ordersCount || 0;
    const topTokensAll = Array.isArray(data.profileTop) ? data.profileTop : [];
    const genreAll = Array.isArray(data.genreCounts) ? data.genreCounts : [];
    const recent30 = data?.recent?.days30 || {};
    const genre30 = Array.isArray(recent30.genreCounts) ? recent30.genreCounts : [];
    const topTokens30 = Array.isArray(recent30.topTokens) ? recent30.topTokens : [];
    const sampleTitles = Array.isArray(data.sampleOrderTitles) ? data.sampleOrderTitles : [];

    // pick texts to translate (top N only)
    const textsToTranslate = [];
    const wantAll = topTokensAll.slice(0, showN).map(x => String(x.t || "")).filter(Boolean);
    const want30 = topTokens30.slice(0, showN).map(x => String(x.t || "")).filter(Boolean);
    const wantSamples = sampleTitles.slice(0, 6).map(x => String(x || "")).filter(Boolean);

    // We translate only if user lang is not zh (still ok to translate anyway)
    const targetLang = ui?.lang || getDefaultUiLang();

    // Build translation map: translated (orig)
    let transMap = new Map();
    try {
        const allTexts = [...wantAll, ...want30, ...wantSamples];
        if (allTexts.length) {
            const trs = await translateBulk(allTexts, targetLang);
            if (trs && trs.length === allTexts.length) {
                for (let i = 0; i < allTexts.length; i++) {
                    const orig = allTexts[i];
                    const tr = String(trs[i] || "").trim();
                    if (tr && tr !== orig) transMap.set(orig, tr);
                }
            }
        }
    } catch (_) {
        // fallback: no translation
    }

    const root = document.createElement("div");

    // KV
    const kv = document.createElement("div");
    kv.className = "aic-kv";
    kv.appendChild(pill(`${t("orders")}: ${ordersCount}`));
    kv.appendChild(pill(`${t("ordersUpdated")}: ${fmtTime(data.ordersUpdatedAt)}`));
    kv.appendChild(pill(`${t("profileUpdated")}: ${fmtTime(data.profileUpdatedAt)}`));
    root.appendChild(kv);

    // token explanation
    const expl = document.createElement("div");
    expl.className = "aic-small";
    expl.textContent = t("tokenWhat");
    root.appendChild(expl);

    // Genres vertical: all time then last30
    const secG1 = document.createElement("div");
    secG1.className = "aic-section";
    secG1.innerHTML = `<h4>${t("genresAll")}</h4>`;
    const barsAll = document.createElement("div"); barsAll.className = "aic-bars";
    secG1.appendChild(barsAll);
    root.appendChild(secG1);
    renderBars(barsAll, genreAll.slice(0, 10), { isGenre: true });

    const secG2 = document.createElement("div");
    secG2.className = "aic-section";
    secG2.innerHTML = `<h4>${t("genres30")}</h4>`;
    const bars30 = document.createElement("div"); bars30.className = "aic-bars";
    secG2.appendChild(bars30);
    root.appendChild(secG2);
    renderBars(bars30, genre30.slice(0, 10), { isGenre: true });

    // Top tokens (all / last30) with translation
    const secT1 = document.createElement("div");
    secT1.className = "aic-section";
    secT1.innerHTML = `<h4>${t("topAll")}</h4>`;
    const tokAll = document.createElement("div");
    tokAll.className = "aic-small";
    tokAll.textContent = wantAll.length
        ? wantAll.map((orig, i) => {
            const tr = transMap.get(orig);
            const shown = tr ? `${tr}（${orig}）` : orig;
            const c = topTokensAll[i]?.c ?? "";
            return `• ${shown} (${c})`;
        }).join("\n")
        : t("noData");
    secT1.appendChild(tokAll);
    root.appendChild(secT1);

    const secT2 = document.createElement("div");
    secT2.className = "aic-section";
    secT2.innerHTML = `<h4>${t("top30")}</h4>`;
    const tok30 = document.createElement("div");
    tok30.className = "aic-small";
    tok30.textContent = want30.length
        ? want30.map((orig, i) => {
            const tr = transMap.get(orig);
            const shown = tr ? `${tr}（${orig}）` : orig;
            const c = topTokens30[i]?.c ?? "";
            return `• ${shown} (${c})`;
        }).join("\n")
        : t("noData");
    secT2.appendChild(tok30);
    root.appendChild(secT2);

    // Samples (translated)
    const secS = document.createElement("div");
    secS.className = "aic-section";
    secS.innerHTML = `<h4>${t("samples")}</h4>`;
    const sBox = document.createElement("div");
    sBox.className = "aic-small";
    sBox.textContent = wantSamples.length
        ? wantSamples.map((orig) => {
            const tr = transMap.get(orig);
            const shown = tr ? `${tr}\n  (${orig})` : orig;
            return `• ${shown}`;
        }).join("\n")
        : t("noData");
    secS.appendChild(sBox);
    root.appendChild(secS);

    overlayContent.innerHTML = "";
    overlayContent.appendChild(root);
}

// pill helper
function pill(text) {
    const d = document.createElement("div");
    d.className = "aic-pill";
    d.textContent = text;
    return d;
}

// =========================
// Header buttons
// =========================
function setHeaderButtonsEnabled(enabled) {
    if (el?.btnSync) el.btnSync.disabled = !enabled;
    if (el?.btnProfile) el.btnProfile.disabled = !enabled;
}

async function runSyncOrders() {
    const lang = ui?.lang || getDefaultUiLang();
    setHeaderButtonsEnabled(false);
    addBubble(t("syncStart"), "bot");

    try {
        const out = await requestPort(
            "AIC_SYNC_ORDERS",
            { lang, maxPages: 15, maxItems: 800, active: false },
            180000
        );
        const d = out?.data;
        if (!d?.ok) {
            addBubble(`${t("syncFail")}\n${d?.message || ""}`, "bot");
            return;
        }
        addBubble(`${t("syncDone")}\nImported: ${d.imported}\nTotal: ${d.totalStored}`, "bot");
    } catch (e) {
        addBubble(`${t("syncFail")}\n${String(e?.message || e)}`, "bot");
    } finally {
        setHeaderButtonsEnabled(true);
    }
}

// =========================
// Search
// =========================
async function sendChat(text) {
    const q = String(text || "").trim();
    if (!q) return;

    addBubble(q, "me");

    const defaultLang = ui?.lang || getDefaultUiLang();
    const detectedLang = await detectLangSmart(q, defaultLang);

    await ensureUiPack(detectedLang, { showWelcome: false, setPlaceholder: false });
    const loading = addBubble(ui.searching || "🔎 Searching…", "bot");

    try {
<<<<<<< Updated upstream
        const out = await requestBG("AI_CHAT", {
            text: q,
            lang: detectedLang, // reply language follows user input language
            provider: "jd",
        });
=======
        const out = await requestPort("AI_CHAT", { text: q, lang: detectedLang, provider: "jd" });
>>>>>>> Stashed changes

        if (loading?.remove) loading.remove();

        if (!out || out.ok === false || !out.data) {
            addBubble(`No response from server/extension.\n${out?.error || ""}`, "bot");
            return;
        }

        const data = out.data;
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        if (!msgs.length) {
            addBubble("Empty response (no messages).", "bot");
            return;
        }

        for (const m of msgs) {
            if (m.type === "text") addBubble(m.content || "", "bot");
            if (m.type === "products") addProducts(Array.isArray(m.items) ? m.items : []);
        }
    } catch (e) {
        if (loading?.remove) loading.remove();
        addBubble(`Network error:\n${String(e?.message || e)}`, "bot");
    }
}

// =========================
// Voice (unchanged)
// =========================
const voice = { recording: false, stream: null, recorder: null, chunks: [], timer: null };

function setMicUI(on) {
    voice.recording = !!on;
    if (!el?.mic) return;
    if (voice.recording) {
        el.mic.classList.add("recording");
        el.mic.textContent = "■";
    } else {
        el.mic.classList.remove("recording");
        el.mic.textContent = "🎤";
    }
}

function cleanupRecording() {
    setMicUI(false);
    if (voice.timer) { clearTimeout(voice.timer); voice.timer = null; }
    if (voice.stream) {
        try { voice.stream.getTracks().forEach((t) => t.stop()); } catch (_) { }
        voice.stream = null;
    }
    voice.recorder = null;
    voice.chunks = [];
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

async function startRecording() {
    if (voice.recording) return;

    addBubble("🎤 ...", "bot");
    setMicUI(true);

    try {
        voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voice.recorder = new MediaRecorder(voice.stream);
        voice.chunks = [];

        voice.recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) voice.chunks.push(e.data);
        };

        voice.recorder.onstop = async () => {
            try {
                const blob = new Blob(voice.chunks, { type: voice.recorder?.mimeType || "audio/webm" });
                const audioBase64 = await blobToBase64(blob);
                cleanupRecording();

                if (!audioBase64) {
                    addBubble("Empty audio data.", "bot");
                    return;
                }

                const sttOut = await requestBG(
                    "AIC_STT",
                    { audioBase64, mimeType: blob.type || "audio/webm" },
                    120000
                );
                const stt = sttOut?.data;

                if (!stt || !stt.ok || !stt.text) {
                    addBubble(`STT failed.\n${stt?.error || sttOut?.error || ""}`, "bot");
                    return;
                }

                await sendChat(stt.text);
            } catch (e) {
                cleanupRecording();
                addBubble(`Voice error:\n${String(e?.message || e)}`, "bot");
            }
        };

        voice.recorder.start();

        voice.timer = setTimeout(() => {
            try {
                if (voice.recorder && voice.recorder.state === "recording") voice.recorder.stop();
            } catch (_) {
                cleanupRecording();
            }
        }, 6500);
    } catch (e) {
        cleanupRecording();
        addBubble(`Mic error: ${String(e?.name || e)}`, "bot");
    }
}

function stopRecording() {
    try {
        if (voice.recorder && voice.recorder.state === "recording") voice.recorder.stop();
        else cleanupRecording();
    } catch (_) {
        cleanupRecording();
    }
}

// =========================
// Init
// =========================
function init() {
    el = {
        msgs: document.getElementById("msgs"),
        inp: document.getElementById("inp"),
        send: document.getElementById("send"),
        mic: document.getElementById("mic"),
        btnSync: document.getElementById("btnSync"),
        btnProfile: document.getElementById("btnProfile"),
    };

    const required = ["msgs", "inp", "send", "mic"];
    const missing = required.filter((k) => !el[k]);
    if (missing.length) {
        console.error("[AIC] sidepanel missing elements:", missing);
        if (el.msgs) addBubble(`⚠️ UI element not found: ${missing.join(", ")}\n(sidepanel.htmlのidを確認してください)`, "bot");
        return;
    }

    connectPort();

    if (el.btnSync) el.btnSync.addEventListener("click", runSyncOrders);
    if (el.btnProfile) el.btnProfile.addEventListener("click", openProfileModal);

    el.send.addEventListener("click", () => {
        const v = el.inp.value;
        el.inp.value = "";
        sendChat(v);
    });

    el.inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            const v = el.inp.value;
            el.inp.value = "";
            sendChat(v);
        }
    });

    el.mic.addEventListener("click", () => {
        if (voice.recording) stopRecording();
        else startRecording();
    });

    (async () => {
        const lang = getDefaultUiLang();
        await ensureUiPack(lang, { showWelcome: true, setPlaceholder: true });
    })();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
