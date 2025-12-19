const el = {
    msgs: document.getElementById('msgs'),
    inp: document.getElementById('inp'),
    send: document.getElementById('send'),
    mic: document.getElementById('mic'),
};

const state = {
    recording: false,
    stream: null,
    recorder: null,
    chunks: [],
    timer: null,
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

function sendToBg(type, payload) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type, payload }, (resp) => {
            const err = chrome.runtime.lastError;
            if (err) resolve({ ok: false, error: err.message });
            else resolve(resp);
        });
    });
}

function detectInputLangLocal(str) {
    if (!str) return 'en';
    if (/[ぁ-んァ-ン]/.test(str)) return 'ja';
    if (/[\uac00-\ud7af]/.test(str)) return 'ko';
    if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(str)) return 'zh';
    return 'en';
}

function searchingTextByInput(str) {
    const lang = detectInputLangLocal(str);
    if (lang === 'ja') return '🔎 検索中です…';
    if (lang === 'zh') return '🔎 正在为你查找…';
    if (lang === 'ko') return '🔎 검색 중입니다…';
    return '🔎 Searching…';
}

async function sendChat(text) {
    const q = String(text || '').trim();
    if (!q) return;

    addBubble(q, 'me');
    const loading = addBubble(searchingTextByInput(q), 'bot');

    const resp = await sendToBg('AI_CHAT', {
        text: q,
        lang: navigator.language || 'ja-JP',
        provider: 'jd'
    });

    if (loading?.remove) loading.remove();

    if (!resp || resp.ok === false || !resp.data) {
        addBubble(`サーバー/拡張機能の応答がありません。\n${resp?.error || ''}`, 'bot');
        return;
    }

    const data = resp.data;
    const msgs = Array.isArray(data.messages) ? data.messages : [];
    if (!msgs.length) {
        addBubble('返答が空でした（messagesがありません）。', 'bot');
        return;
    }

    for (const m of msgs) {
        if (m.type === 'text') addBubble(m.content || '', 'bot');
        if (m.type === 'products') addProducts(Array.isArray(m.items) ? m.items : []);
    }
}

// ---- Voice (record in sidepanel) ----
async function startRecording() {
    if (state.recording) return;

    state.recording = true;
    el.mic.classList.add('recording');
    el.mic.textContent = '■';

    addBubble('🎤 聞いています…', 'bot');

    try {
        state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.recorder = new MediaRecorder(state.stream);
        state.chunks = [];

        state.recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) state.chunks.push(e.data);
        };

        state.recorder.onstop = async () => {
            await finishRecording();
        };

        state.recorder.start();

        state.timer = setTimeout(() => {
            stopRecording();
        }, 6500);
    } catch (e) {
        cleanupRecording();
        addBubble(`音声入力に失敗しました: ${String(e?.name || e)}`, 'bot');
    }
}

function stopRecording() {
    try {
        if (state.recorder && state.recorder.state === 'recording') {
            state.recorder.stop();
        } else {
            cleanupRecording();
        }
    } catch (_) {
        cleanupRecording();
    }
}

function cleanupRecording() {
    state.recording = false;
    el.mic.classList.remove('recording');
    el.mic.textContent = '🎤';

    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    if (state.stream) {
        try { state.stream.getTracks().forEach((t) => t.stop()); } catch (_) { }
        state.stream = null;
    }
    state.recorder = null;
}

async function blobToBase64(blob) {
    return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

async function finishRecording() {
    try {
        const blob = new Blob(state.chunks, { type: state.recorder?.mimeType || 'audio/webm' });
        const audioBase64 = await blobToBase64(blob);

        cleanupRecording();

        if (!audioBase64) {
            addBubble('音声データが空でした。', 'bot');
            return;
        }

        const sttResp = await sendToBg('AIC_STT', { audioBase64, mimeType: blob.type || 'audio/webm' });
        const stt = sttResp?.data;

        if (!stt || !stt.ok || !stt.text) {
            addBubble(`音声認識に失敗しました。\n${stt?.error || sttResp?.error || ''}`, 'bot');
            return;
        }

        await sendChat(stt.text);
    } catch (e) {
        cleanupRecording();
        addBubble(`音声処理エラー: ${String(e?.name || e)}`, 'bot');
    }
}

// ---- UI events ----
el.send.addEventListener('click', () => sendChat(el.inp.value));
el.inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat(el.inp.value);
        el.inp.value = '';
    }
});

el.mic.addEventListener('click', () => {
    if (state.recording) stopRecording();
    else startRecording();
});

// initial
addBubble('欲しいものを入力してください（JD固定）。例）「拉面」「ノートPC 4万円 軽い」', 'bot');
