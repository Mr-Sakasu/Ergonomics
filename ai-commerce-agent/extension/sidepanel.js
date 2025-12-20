// extension/sidepanel.js (REPLACE WHOLE FILE)
// - Port通信のみ（sendMessageは使わない）
// - JD固定（provider: 'jd'）
// - 音声: SidePanel内で録音 → backgroundへAIC_STT → 文字起こし → AI_CHAT
//
// Changes:
// - 初期メッセージ/入力placeholderを AIC_UI_INIT 経由で API(/api/ui-init) から取得（多言語対応）
// - 画面上の "（JD固定 / Modeなし）" 文言を見つけたら自動で削除
// - "検索中..." の表示言語は「直前に入力された言語」を優先（簡易判定）

const el = {
    msgs: document.getElementById('msgs'),
    inp: document.getElementById('inp'),
    send: document.getElementById('send'),
    mic: document.getElementById('mic'),
};

function addBubble(text, who = 'bot') {
    const div = document.createElement('div');
    div.className = `bubble ${who === 'me' ? 'me' : 'bot'}`;
    div.textContent = String(text || '');
    el.msgs.appendChild(div);
    el.msgs.scrollTop = el.msgs.scrollHeight;
    return div;
}

function addProducts(items = []) {
    const wrap = document.createElement('div');
    wrap.className = 'products';

    for (const it of items) {
        const card = document.createElement('div');
        card.className = 'card';

        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        if (it.image) {
            const img = document.createElement('img');
            img.src = it.image;
            img.alt = it.title || '';
            thumb.appendChild(img);
        } else {
            thumb.textContent = 'No Image';
        }

        const meta = document.createElement('div');
        meta.className = 'meta';

        const t = document.createElement('div');
        t.className = 't';
        t.textContent = it.title || '';

        const d = document.createElement('div');
        d.className = 'd';
        d.textContent = it.description || '';

        const p = document.createElement('div');
        p.className = 'p';
        p.textContent = `${it.price || '価格不明'}${it.source ? ` · ${it.source}` : ''}`;

        meta.appendChild(t);
        if (it.description) meta.appendChild(d);
        meta.appendChild(p);

        const open = document.createElement('button');
        open.className = 'open';
        open.textContent = '開く';
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

// ===== Port通信 =====
const port = chrome.runtime.connect({ name: 'aic' });
const pending = new Map();

port.onMessage.addListener((msg) => {
    const jobId = msg?.jobId;
    if (!jobId) return;

    const p = pending.get(jobId);
    if (!p) return;
    pending.delete(jobId);

    if (msg.type === 'AI_CHAT_RESULT') p.resolve(msg.out);
    else if (msg.type === 'AIC_STT_RESULT') p.resolve(msg.out);
    else if (msg.type === 'AIC_UI_INIT_RESULT') p.resolve(msg.out);
    else p.reject(new Error(msg?.error || 'unknown_error'));
});

port.onDisconnect.addListener(() => {
    for (const [jobId, p] of pending.entries()) {
        p.reject(new Error('port_disconnected'));
        pending.delete(jobId);
    }
    addBubble('⚠️ 背景プロセスとの接続が切れました。拡張機能を再読み込みしてください。', 'bot');
});

function requestPort(type, payload, timeoutMs = 120000) {
    const jobId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            pending.delete(jobId);
            reject(new Error('timeout'));
        }, timeoutMs);

        pending.set(jobId, {
            resolve: (v) => { clearTimeout(t); resolve(v); },
            reject: (e) => { clearTimeout(t); reject(e); },
        });

        port.postMessage({ type, jobId, payload });
    });
}

// ===== (JD固定 / Modeなし) の表示を消す =====
function stripFixedModeText() {
    const patterns = [
        /\(\s*JD固定\s*\/\s*Modeなし\s*\)/g,
        /（\s*JD固定\s*\/\s*Modeなし\s*）/g,
        /\(\s*JD\s*固定\s*\/\s*Mode\s*なし\s*\)/g,
        /（\s*JD\s*固定\s*\/\s*Mode\s*なし\s*）/g,
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
        const n = walker.currentNode;
        const v = String(n.nodeValue || '');
        if (v.includes('JD固定') || v.includes('Modeなし')) nodes.push(n);
    }

    for (const n of nodes) {
        let v = String(n.nodeValue || '');
        for (const re of patterns) v = v.replace(re, '');
        v = v.replace(/\s{2,}/g, ' ').trim();
        n.nodeValue = v;
    }
}

// ===== 表示用言語（検索中表示用）=====
// NOTE: ここは簡易。日本語/中国語/韓国語以外は en 扱い。
// 初期UIは /api/ui-init が多言語化してくれるので問題になりにくいです。
function detectInputLangLocal(str) {
    if (!str) return 'en';
    if (/[ぁ-んァ-ン]/.test(str)) return 'ja';
    if (/[\uac00-\ud7af]/.test(str)) return 'ko';
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(str)) return 'zh';
    return 'en';
}
function toBcp47(base) {
    const b = String(base || 'en').toLowerCase();
    if (b === 'ja') return 'ja-JP';
    if (b === 'zh') return 'zh-CN';
    if (b === 'ko') return 'ko-KR';
    return 'en-US';
}

let lastUiLang = navigator.language || 'en-US';

function searchingTextByLang(langTag) {
    const b = String(langTag || '').toLowerCase().split(/[-_]/)[0];
    if (b === 'ja') return '🔎 検索中です…';
    if (b === 'zh') return '🔎 正在为你查找…';
    if (b === 'ko') return '🔎 검색 중입니다…';
    return '🔎 Searching…';
}

// ===== 初期メッセージ/placeholder を API から取得 =====
async function initUiFromApi() {
    // remove fixed text as early as possible
    try { stripFixedModeText(); } catch (_) { }

    const lang = navigator.language || 'en-US';
    lastUiLang = lang;

    // cache (localStorage)
    const cacheKey = `aic_ui_init_v1_${lang}`;
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            const j = JSON.parse(cached);
            if (j?.welcome) addBubble(j.welcome, 'bot');
            if (j?.placeholder) el.inp.placeholder = j.placeholder;
            setTimeout(stripFixedModeText, 50);
            return;
        }
    } catch (_) { }

    const tmp = addBubble('…', 'bot');

    try {
        const out = await requestPort('AIC_UI_INIT', { lang }, 120000);
        const data = out?.data;

        if (tmp?.remove) tmp.remove();

        if (data?.ok && (data.welcome || data.placeholder)) {
            if (data.welcome) addBubble(data.welcome, 'bot');
            if (data.placeholder) el.inp.placeholder = data.placeholder;

            try { localStorage.setItem(cacheKey, JSON.stringify({ welcome: data.welcome, placeholder: data.placeholder })); } catch (_) { }
        } else {
            // fallback minimal
            addBubble('Tell me what you want (JD search).', 'bot');
        }
    } catch (e) {
        if (tmp?.remove) tmp.remove();
        addBubble('Tell me what you want (JD search).', 'bot');
    } finally {
        setTimeout(stripFixedModeText, 80);
    }
}

// ===== メイン送信 =====
async function sendChat(text) {
    const q = String(text || '').trim();
    if (!q) return;

    // update lastUiLang based on input
    const base = detectInputLangLocal(q);
    lastUiLang = toBcp47(base);

    addBubble(q, 'me');
    const loading = addBubble(searchingTextByLang(lastUiLang), 'bot');

    try {
        const out = await requestPort('AI_CHAT', {
            text: q,
            lang: lastUiLang,
            provider: 'jd',
        });

        if (loading?.remove) loading.remove();

        if (!out || out.ok === false || !out.data) {
            addBubble(`サーバー/拡張機能の応答がありません。\n${out?.error || ''}`, 'bot');
            return;
        }

        const data = out.data;
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        if (!msgs.length) {
            addBubble('返答が空でした（messagesがありません）。', 'bot');
            return;
        }

        for (const m of msgs) {
            if (m.type === 'text') addBubble(m.content || '', 'bot');
            if (m.type === 'products') addProducts(Array.isArray(m.items) ? m.items : []);
        }

        // In case header text was re-rendered
        try { stripFixedModeText(); } catch (_) { }

    } catch (e) {
        if (loading?.remove) loading.remove();
        addBubble(`通信エラー:\n${String(e?.message || e)}`, 'bot');
    }
}

// ===== 音声（SidePanel内で録音）=====
const voice = {
    recording: false,
    stream: null,
    recorder: null,
    chunks: [],
    timer: null,
};

function setMicUI(on) {
    voice.recording = !!on;
    if (voice.recording) {
        el.mic.classList.add('recording');
        el.mic.textContent = '■';
    } else {
        el.mic.classList.remove('recording');
        el.mic.textContent = '🎤';
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
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

async function startRecording() {
    if (voice.recording) return;

    addBubble('🎤 ...', 'bot');
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
                const blob = new Blob(voice.chunks, { type: voice.recorder?.mimeType || 'audio/webm' });
                const audioBase64 = await blobToBase64(blob);
                cleanupRecording();

                if (!audioBase64) {
                    addBubble('音声データが空でした。', 'bot');
                    return;
                }

                const sttOut = await requestPort(
                    'AIC_STT',
                    { audioBase64, mimeType: blob.type || 'audio/webm' },
                    120000
                );

                const stt = sttOut?.data;
                if (!stt || !stt.ok || !stt.text) {
                    addBubble(`音声認識に失敗しました。\n${stt?.error || sttOut?.error || ''}`, 'bot');
                    return;
                }

                await sendChat(stt.text);
            } catch (e) {
                cleanupRecording();
                addBubble(`音声処理エラー:\n${String(e?.message || e)}`, 'bot');
            }
        };

        voice.recorder.start();

        voice.timer = setTimeout(() => {
            try {
                if (voice.recorder && voice.recorder.state === 'recording') voice.recorder.stop();
            } catch (_) {
                cleanupRecording();
            }
        }, 6500);

    } catch (e) {
        cleanupRecording();
        addBubble(`音声入力に失敗しました: ${String(e?.name || e)}`, 'bot');
    }
}

function stopRecording() {
    try {
        if (voice.recorder && voice.recorder.state === 'recording') voice.recorder.stop();
        else cleanupRecording();
    } catch (_) {
        cleanupRecording();
    }
}

// ===== UI events =====
el.send.addEventListener('click', () => {
    const v = el.inp.value;
    el.inp.value = '';
    sendChat(v);
});

el.inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = el.inp.value;
        el.inp.value = '';
        sendChat(v);
    }
});

el.mic.addEventListener('click', () => {
    if (voice.recording) stopRecording();
    else startRecording();
});

// initial
initUiFromApi();
