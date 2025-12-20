// extension/sidepanel.js (REPLACE WHOLE FILE)
// Fix: Ensure DOM is ready before binding events (prevents send button "no response").
// Fix: Robust language detect for ANY language (chrome.i18n.detectLanguage first + timeout, then remote fallback).
// Fix: UI pack cache key bumped to v3.

console.log("[AIC] sidepanel.js loaded");

let el = null;

function addBubble(text, who = "bot") {
    if (!el?.msgs) return null;
    const div = document.createElement("div");
    div.className = `bubble ${who === "me" ? "me" : "bot"}`;
    div.textContent = String(text || "");
    el.msgs.appendChild(div);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return div;
}

// ===== Port通信 =====
const port = chrome.runtime.connect({ name: "aic" });
const pending = new Map();

port.onMessage.addListener((msg) => {
    const jobId = msg?.jobId;
    if (!jobId) return;

    const p = pending.get(jobId);
    if (!p) return;
    pending.delete(jobId);

    if (msg.type === "AI_CHAT_RESULT") p.resolve(msg.out);
    else if (msg.type === "AIC_STT_RESULT") p.resolve(msg.out);
    else if (msg.type === "AIC_UI_INIT_RESULT") p.resolve(msg.out);
    else if (msg.type === "AIC_LANG_DETECT_RESULT") p.resolve(msg.out);
    else p.reject(new Error(msg?.error || "unknown_error"));
});

port.onDisconnect.addListener(() => {
    for (const [jobId, p] of pending.entries()) {
        p.reject(new Error("port_disconnected"));
        pending.delete(jobId);
    }
    addBubble("⚠️ Connection to background process was lost. Please reload the extension.", "bot");
});

function requestPort(type, payload, timeoutMs = 120000) {
    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            pending.delete(jobId);
            reject(new Error("timeout"));
        }, timeoutMs);

        pending.set(jobId, {
            resolve: (v) => {
                clearTimeout(t);
                resolve(v);
            },
            reject: (e) => {
                clearTimeout(t);
                reject(e);
            },
        });

        try {
            port.postMessage({ type, jobId, payload });
        } catch (e) {
            clearTimeout(t);
            pending.delete(jobId);
            reject(e);
        }
    });
}

// ===== lang helpers =====
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
        return b; // fr/de/es/... keep as 2-letter
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

function getDefaultUiLang() {
    try {
        const l = chrome.i18n?.getUILanguage?.();
        if (l) return normalizeLangTag(l);
    } catch (_) { }
    return normalizeLangTag(navigator.language || "en-US");
}

// ===== UI pack (per language) =====
const uiCache = new Map(); // lang -> pack
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

    // localStorage cache
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

    // fetch via background -> /api/ui-init
    const out = await requestPort("AIC_UI_INIT", { lang: norm }, 120000);
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

        try {
            localStorage.setItem(`aic_ui_pack_v3_${pack.lang}`, JSON.stringify(pack));
        } catch (_) { }

        if (setPlaceholder && pack.placeholder && el?.inp) el.inp.placeholder = pack.placeholder;
        if (showWelcome && pack.welcome) addBubble(pack.welcome, "bot");
        return pack;
    }

    ui = { ...ui, lang: norm };
    return ui;
}

// ===== Language detect (ANY language) =====
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
        const out = await requestPort("AIC_LANG_DETECT", { text, defaultLang }, 120000);
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

// ===== Products renderer (uses current ui pack) =====
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

        const t = document.createElement("div");
        t.className = "t";
        t.textContent = it.title || "";

        const d = document.createElement("div");
        d.className = "d";
        d.textContent = it.description || "";

        const p = document.createElement("div");
        p.className = "p";
        p.textContent =
            `${it.price || ""}${it.source ? ` · ${it.source}` : ""}`.trim() ||
            (it.source ? `· ${it.source}` : "");

        meta.appendChild(t);
        if (it.description) meta.appendChild(d);
        meta.appendChild(p);

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

// ===== Main send =====
async function sendChat(text) {
    const q = String(text || "").trim();
    if (!q) return;

    addBubble(q, "me");

    const defaultLang = ui?.lang || getDefaultUiLang();
    const detectedLang = await detectLangSmart(q, defaultLang);

    await ensureUiPack(detectedLang, { showWelcome: false, setPlaceholder: false });
    const loading = addBubble(ui.searching || "🔎 Searching…", "bot");

    try {
        const out = await requestPort("AI_CHAT", {
            text: q,
            lang: detectedLang, // reply language follows user input language
            provider: "jd",
        });

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

// ===== Voice (same as yours) =====
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
    if (voice.timer) {
        clearTimeout(voice.timer);
        voice.timer = null;
    }
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

                const sttOut = await requestPort("AIC_STT", { audioBase64, mimeType: blob.type || "audio/webm" }, 120000);
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

// ===== Init AFTER DOM ready =====
function init() {
    el = {
        msgs: document.getElementById("msgs"),
        inp: document.getElementById("inp"),
        send: document.getElementById("send"),
        mic: document.getElementById("mic"),
    };

    // If IDs mismatch, show a visible error instead of silently dying.
    const missing = Object.entries(el).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
        console.error("[AIC] sidepanel missing elements:", missing);
        // try to show in UI if possible
        if (el.msgs) addBubble(`⚠️ UI element not found: ${missing.join(", ")}\n(sidepanel.htmlのidを確認してください)`, "bot");
        return;
    }

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
