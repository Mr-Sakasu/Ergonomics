// extension/sidepanel.js
const API_BASE = "https://ergonomics-mu.vercel.app/api";

const el = {
    messages: document.getElementById("messages"),
    input: document.getElementById("input"),
    btnSend: document.getElementById("btnSend"),
    btnMic: document.getElementById("btnMic"),
    btnUsePage: document.getElementById("btnUsePage"),
    btnClear: document.getElementById("btnClear"),
    connDot: document.getElementById("connDot"),
    pageLine: document.getElementById("pageLine"),
    siteHost: document.getElementById("siteHost"),
    chipMode: document.getElementById("chipMode"),
    modeText: document.getElementById("modeText"),
    chipCtx: document.getElementById("chipCtx"),
    ctxText: document.getElementById("ctxText"),
};

let state = {
    active: { tabId: null, hostname: "", url: "", title: "", accessible: false, updatedAt: 0 },
    ctxEnabled: false,
    page: null,
    recording: false,
    voiceSession: null,
};

const BROWSER_LANG = (navigator.language || "en-US").toLowerCase();

function t(key) {
    const JA = {
        welcome:
            "欲しいものを送ってください。例）「京東で 2000元以内のスマホ」「軽いノートPC 4万円台」\n必要なときだけ Context で“今見ているページ”を参考にできます。",
        errServer: "サーバーエラーです。",
        errFormat: "返却形式が想定と違います。",
        listening: "🎤 聞いています…（もう一度押すと停止）",
        voiceNeedPage: "音声入力は、通常のWebページ（https://...）上で使ってください。",
        voiceNeedHttps: "音声入力は https:// のページでのみ動作します。",
        voiceDenied:
            "マイクが拒否されました（NotAllowedError）。\n① Chromeのアドレスバー左の🔒（サイト設定）→ マイクを「許可」\n② もう一度🎤を押してください。",
        voiceNoPermission:
            "このページにアクセスできません。\n一度、対象ページを開いた状態で拡張機能アイコンをクリックしてから、🎤を押してください。",
        voiceOther: "音声入力に失敗しました。",
        ctxOn: "ON",
        ctxOff: "OFF",
        ctxCaptured: "ページをコンテキストに設定しました。",
        ctxCleared: "ページコンテキストを解除しました。",
        searching_ja: "🔎 検索中です…",
        searching_en: "🔎 Searching…",
        searching_zh: "🔎 正在为你查找…",
        searching_ko: "🔎 검색 중입니다…",
    };

    const EN = {
        welcome:
            "Tell me what you want. e.g. “phone under 2000 CNY on JD”, “lightweight laptop around $400”.\nUse Context only when needed.",
        errServer: "Server error.",
        errFormat: "Unexpected response format.",
        listening: "🎤 Listening… (click again to stop)",
        voiceNeedPage: "Voice input works on normal web pages (https://...).",
        voiceNeedHttps: "Voice input requires an https:// page.",
        voiceDenied:
            "Microphone permission denied (NotAllowedError).\nOpen site settings (🔒) and allow Microphone, then try again.",
        voiceNoPermission:
            "Cannot access this page.\nClick the extension icon once on the target page, then try 🎤 again.",
        voiceOther: "Voice input failed.",
        ctxOn: "ON",
        ctxOff: "OFF",
        ctxCaptured: "Page context captured.",
        ctxCleared: "Page context cleared.",
        searching_ja: "🔎 検索中です…",
        searching_en: "🔎 Searching…",
        searching_zh: "🔎 正在为你查找…",
        searching_ko: "🔎 검색 중입니다…",
    };

    const L = BROWSER_LANG.startsWith("ja") ? JA : EN;
    return L[key] ?? "";
}

function detectInputLangLocal(str) {
    if (!str) return "en";
    if (/[ぁ-んァ-ン]/.test(str)) return "ja";
    if (/[\uac00-\ud7af]/.test(str)) return "ko";
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(str)) return "zh";
    return "en";
}
function searchingTextByInput(str) {
    const lang = detectInputLangLocal(str);
    if (lang === "ja") return t("searching_ja");
    if (lang === "zh") return t("searching_zh");
    if (lang === "ko") return t("searching_ko");
    return t("searching_en");
}

function scrollToBottom() {
    el.messages.scrollTop = el.messages.scrollHeight;
}
function addBubble(text, who = "ai") {
    const div = document.createElement("div");
    div.className = `bubble ${who}`;
    div.textContent = text;
    el.messages.appendChild(div);
    scrollToBottom();
    return div;
}
function addMeta(text) {
    const div = document.createElement("div");
    div.className = "bubble meta";
    div.textContent = text;
    el.messages.appendChild(div);
    scrollToBottom();
    return div;
}
function addProducts(items = []) {
    if (!Array.isArray(items) || items.length === 0) return;
    const wrap = document.createElement("div");
    wrap.className = "products";

    for (const it of items.slice(0, 6)) {
        const card = document.createElement("div");
        card.className = "pCard";

        const thumb = document.createElement("div");
        thumb.className = "thumb";
        if (it?.image) {
            const img = document.createElement("img");
            img.src = String(it.image);
            img.alt = it?.title ? String(it.title) : "";
            thumb.textContent = "";
            thumb.appendChild(img);
        } else {
            thumb.textContent = "No Image";
        }

        const info = document.createElement("div");
        info.className = "pInfo";

        const title = document.createElement("p");
        title.className = "pTitle";
        title.textContent = it?.title ? String(it.title) : "(no title)";
        info.appendChild(title);

        if (it?.description) {
            const desc = document.createElement("div");
            desc.className = "pDesc";
            desc.textContent = String(it.description);
            info.appendChild(desc);
        }

        const meta = document.createElement("div");
        meta.className = "pMeta";
        const price = document.createElement("span");
        price.textContent =
            it?.price ? String(it.price) : (BROWSER_LANG.startsWith("ja") ? "価格不明" : "Unknown price");
        meta.appendChild(price);

        if (it?.source) {
            const src = document.createElement("span");
            src.className = "src";
            src.textContent = `· ${String(it.source)}`;
            meta.appendChild(src);
        }
        info.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "pActions";
        if (it?.url) {
            const a = document.createElement("a");
            a.href = String(it.url);
            a.target = "_blank";
            a.rel = "noreferrer";
            a.textContent = BROWSER_LANG.startsWith("ja") ? "開く" : "Open";
            actions.appendChild(a);
        }
        info.appendChild(actions);

        card.appendChild(thumb);
        card.appendChild(info);
        wrap.appendChild(card);
    }

    el.messages.appendChild(wrap);
    scrollToBottom();
}

// ---------- Active page info ----------
async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
}
function isJDHost(hostname) {
    const h = (hostname || "").toLowerCase();
    return h === "jd.com" || h.endsWith(".jd.com");
}
function looksLikeJDQuery(text) {
    const s = String(text || "");
    return /(^|\b)jd(\b|$)|京东|京東|jingdong/i.test(s);
}
async function probeActivePage(tabId) {
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
                url: location.href || "",
                hostname: location.hostname || "",
                title: document.title || "",
            }),
        });
        return { ok: true, ...(result || {}) };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}
function applyHeader() {
    const host = state.active.hostname || "-";
    el.siteHost.textContent = host;
    el.pageLine.textContent = `Active page: ${host === "-" ? "(no page)" : host}`;
    el.connDot.classList.toggle("on", host !== "-");

    const mode = isJDHost(state.active.hostname) ? "JD" : "Auto";
    el.modeText.textContent = mode;
    el.chipMode.classList.toggle("on", mode === "JD");

    el.ctxText.textContent = state.ctxEnabled ? t("ctxOn") : t("ctxOff");
    el.chipCtx.classList.toggle("on", state.ctxEnabled);
}
async function refreshHeader(force = false) {
    const now = Date.now();
    if (!force && now - state.active.updatedAt < 2500) return;

    const tabId = await getActiveTabId();
    state.active.tabId = tabId;

    if (!tabId) {
        state.active = { tabId: null, hostname: "", url: "", title: "", accessible: false, updatedAt: now };
        applyHeader();
        return;
    }

    const probe = await probeActivePage(tabId);
    if (probe.ok) {
        state.active.hostname = String(probe.hostname || "");
        state.active.url = String(probe.url || "");
        state.active.title = String(probe.title || "");
        state.active.accessible = true;
    } else {
        state.active.hostname = "";
        state.active.url = "";
        state.active.title = "";
        state.active.accessible = false;
    }
    state.active.updatedAt = now;
    applyHeader();
}
refreshHeader(true);
setInterval(() => refreshHeader(false), 1500);

// ---------- Context ----------
async function capturePageContext() {
    const tabId = state.active.tabId ?? (await getActiveTabId());
    if (!tabId) return null;

    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => ({
                title: document.title || "",
                url: location.href || "",
                text: (document.body?.innerText || "").slice(0, 8000),
            }),
        });
        return result || null;
    } catch {
        return null;
    }
}

el.btnUsePage.addEventListener("click", async () => {
    await refreshHeader(true);

    if (state.ctxEnabled) {
        state.ctxEnabled = false;
        state.page = null;
        addMeta(t("ctxCleared"));
        applyHeader();
        return;
    }

    const ctx = await capturePageContext();
    if (ctx) {
        state.ctxEnabled = true;
        state.page = ctx;
        addMeta(t("ctxCaptured"));
    } else {
        addMeta(BROWSER_LANG.startsWith("ja") ? "このページは取得できませんでした。" : "Cannot capture this page.");
    }
    applyHeader();
});

el.btnClear.addEventListener("click", () => {
    el.messages.innerHTML = "";
    addBubble(t("welcome"), "ai");
});

async function callChatbot(payload) {
    return await chrome.runtime.sendMessage({ type: "AI_CHAT", payload });
}

async function sttTranscribe(audioBase64, mimeType) {
    const r = await fetch(`${API_BASE}/stt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType }),
    }).catch(() => null);

    return r ? await r.json().catch(() => null) : null;
}

function decideProvider(siteHost, userText) {
    if (isJDHost(siteHost)) return "jd";
    if (looksLikeJDQuery(userText)) return "jd";
    return "";
}

async function sendChat(userTextRaw, opts = {}) {
    const userText = (userTextRaw || "").trim();
    if (!userText) return;

    addBubble(userText, "me");
    await refreshHeader(true);

    const siteHost = (opts.siteHostOverride || state.active.hostname || "").trim();
    const loading = addBubble(searchingTextByInput(userText), "ai");

    let composed = userText;
    if (state.ctxEnabled && state.page) {
        const ctxText = (state.page.text || "").slice(0, 700);
        composed += `\n\n[PageContext]\nTitle: ${state.page.title || ""}\nURL: ${state.page.url || ""}\nText: ${ctxText}`;
    }

    const payload = {
        text: composed,
        lang: detectInputLangLocal(userText),
        siteHost,
        provider: decideProvider(siteHost, userText),
    };

    const resp = await callChatbot(payload).catch(() => null);
    if (loading?.remove) loading.remove();

    if (!resp || !resp.ok) {
        addBubble(t("errServer"), "ai");
        return;
    }
    const data = resp.data;
    if (!data || !Array.isArray(data.messages)) {
        addBubble(t("errFormat"), "ai");
        return;
    }
    for (const m of data.messages) {
        if (m.type === "text") addBubble(String(m.content || ""), "ai");
        if (m.type === "products") addProducts(m.items || []);
    }
}

el.btnSend.addEventListener("click", async () => {
    const text = el.input.value;
    el.input.value = "";
    await sendChat(text);
    el.input.focus();
});
el.input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        el.btnSend.click();
    }
});

// ---------- Voice ----------
function setRecordingUI(on) {
    state.recording = on;
    el.btnMic.classList.toggle("recording", on);
    el.btnMic.textContent = on ? "■" : "🎤";
}
function newSessionId() {
    try { return crypto.randomUUID(); }
    catch { return String(Date.now()) + "-" + Math.random().toString(16).slice(2); }
}

chrome.runtime.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "AIC_VOICE_RESULT") return;
    if (!state.voiceSession || msg.sessionId !== state.voiceSession) return;

    setRecordingUI(false);

    if (!msg.ok) {
        const err = String(msg.error || "");
        if (err.includes("NotAllowedError")) addBubble(t("voiceDenied"), "ai");
        else if (err.includes("SecurityError")) addBubble(t("voiceNeedHttps"), "ai");
        else addBubble(`${t("voiceOther")} (${err || "error"})`, "ai");
        return;
    }

    const audioBase64 = msg.audioBase64 || "";
    const mimeType = msg.mimeType || "audio/webm";
    if (!audioBase64) {
        addBubble(t("voiceOther"), "ai");
        return;
    }

    const siteHostOverride = String(msg.siteHost || "").trim();

    const stt = await sttTranscribe(audioBase64, mimeType);
    if (!stt || !stt.ok || !stt.text) {
        addBubble(t("voiceOther"), "ai");
        return;
    }

    await sendChat(String(stt.text), { siteHostOverride });
});

async function startVoice() {
    await refreshHeader(true);
    const tabId = state.active.tabId ?? (await getActiveTabId());
    if (!tabId) {
        addBubble(t("voiceNeedPage"), "ai");
        return;
    }

    state.voiceSession = newSessionId();
    addBubble(t("listening"), "ai");
    setRecordingUI(true);

    const resp = await chrome.runtime.sendMessage({
        type: "AIC_VOICE_START",
        payload: { tabId, maxMs: 6000, sessionId: state.voiceSession },
    }).catch(() => null);

    if (!resp?.ok) {
        setRecordingUI(false);

        const err = String(resp?.error || "");
        if (err === "restricted_chrome_url" || err === "restricted_webstore") {
            addBubble(t("voiceNeedPage"), "ai");
            return;
        }
        if (err === "cannot_access_page" || err === "missing_host_permission") {
            addBubble(t("voiceNoPermission"), "ai");
            return;
        }
        addBubble(`${t("voiceOther")} (${err || "start_failed"})`, "ai");
    }
}
async function stopVoice() {
    const tabId = state.active.tabId ?? (await getActiveTabId());
    if (!tabId) {
        setRecordingUI(false);
        return;
    }
    await chrome.runtime.sendMessage({
        type: "AIC_VOICE_STOP",
        payload: { tabId },
    }).catch(() => null);
}

el.btnMic.addEventListener("click", async () => {
    if (state.recording) await stopVoice();
    else await startVoice();
});

// init
addBubble(t("welcome"), "ai");
el.input.focus();
