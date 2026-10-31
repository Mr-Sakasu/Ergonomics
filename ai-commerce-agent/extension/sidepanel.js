// extension/sidepanel.js (REPLACE WHOLE FILE)
// Adds: sidepanel image input -> background vision -> zh query -> scrape JD
// Keeps: existing text chat + voice input

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

function addImageBubble(objectUrl, who = "me") {
    if (!el?.msgs) return null;
    const wrap = document.createElement("div");
    wrap.className = `bubble ${who === "me" ? "me" : "bot"}`;

    const box = document.createElement("div");
    box.className = "imgbox";

    const img = document.createElement("img");
    img.src = objectUrl;
    img.alt = "image";
    box.appendChild(img);

    wrap.appendChild(box);
    el.msgs.appendChild(wrap);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return wrap;
}

// ===== Background通信 (MV3 Service Worker friendly) =====
function requestBG(type, payload, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
        let done = false;

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error("timeout"));
        }, timeoutMs);

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
    const out = await requestBG("AIC_UI_INIT", { lang: norm }, 120000);
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

// ===== Image helpers (resize + base64) =====
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

async function imageFileToJpegBase64(file, { maxSide = 768, quality = 0.86 } = {}) {
    const url = URL.createObjectURL(file);
    try {
        let imgW = 0, imgH = 0;
        let bitmap = null;

        // prefer createImageBitmap (faster)
        try {
            bitmap = await createImageBitmap(file);
            imgW = bitmap.width;
            imgH = bitmap.height;
        } catch (_) {
            bitmap = null;
        }

        let drawSource = bitmap;
        if (!drawSource) {
            const img = new Image();
            img.src = url;
            await new Promise((res, rej) => {
                img.onload = () => res(true);
                img.onerror = rej;
            });
            imgW = img.naturalWidth || img.width;
            imgH = img.naturalHeight || img.height;
            drawSource = img;
        }

        const scale = Math.min(1, maxSide / Math.max(imgW, imgH));
        const w = Math.max(1, Math.round(imgW * scale));
        const h = Math.max(1, Math.round(imgH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.drawImage(drawSource, 0, 0, w, h);

        const jpegBlob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
        });

        if (!jpegBlob) throw new Error("toBlob_failed");

        const base64 = await blobToBase64(jpegBlob);
        return { base64, mimeType: "image/jpeg", width: w, height: h };
    } finally {
        try { URL.revokeObjectURL(url); } catch (_) { }
    }
}

// ===== Main send (text) =====
async function sendChat(text) {
    const q = String(text || "").trim();
    if (!q) return;

    addBubble(q, "me");

    const defaultLang = ui?.lang || getDefaultUiLang();
    const detectedLang = await detectLangSmart(q, defaultLang);

    await ensureUiPack(detectedLang, { showWelcome: false, setPlaceholder: false });
    const loading = addBubble(ui.searching || "🔎 Searching…", "bot");

    try {
        const out = await requestBG("AI_CHAT", {
            text: q,
            lang: detectedLang,
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

// ===== Image search =====
async function sendImageFile(file) {
    if (!file) return;

    // preview in chat (object URL)
    const previewUrl = URL.createObjectURL(file);
    addImageBubble(previewUrl, "me");

    // The response language: current UI lang (or browser lang)
    const replyLang = normalizeLangTag(ui?.lang || getDefaultUiLang());

    const loading = addBubble("🖼️ Analyzing image…", "bot");

    try {
        // resize+compress so messages are small
        const { base64, mimeType, width, height } = await imageFileToJpegBase64(file, { maxSide: 768, quality: 0.86 });

        const out = await requestBG("AI_IMAGE", {
            imageBase64: base64,
            mimeType,
            width,
            height,
            lang: replyLang,
            provider: "jd",
        }, 180000);

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
        addBubble(`Image error:\n${String(e?.message || e)}`, "bot");
    } finally {
        // keep preview shown; just revoke the object url (img keeps its decoded bitmap)
        try { URL.revokeObjectURL(previewUrl); } catch (_) { }
        if (el?.file) el.file.value = ""; // allow picking same file again
    }
}

// ===== Voice (unchanged) =====
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

// ===== Init AFTER DOM ready =====
function init() {
    el = {
        msgs: document.getElementById("msgs"),
        inp: document.getElementById("inp"),
        send: document.getElementById("send"),
        mic: document.getElementById("mic"),
        img: document.getElementById("img"),
        file: document.getElementById("file"),
    };

    const missing = Object.entries(el).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
        console.error("[AIC] sidepanel missing elements:", missing);
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

    // NEW: image button
    el.img.addEventListener("click", () => {
        el.file.click();
    });
    el.file.addEventListener("change", async () => {
        const f = el.file.files?.[0];
        if (!f) return;
        await sendImageFile(f);
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
