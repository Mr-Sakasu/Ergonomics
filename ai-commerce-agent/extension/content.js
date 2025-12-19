// extension/content.js
// AI Commerce Bot – fixed panel, multi-lang, per-input “searching…”
console.log('[AIC] content v1.6 loaded');

// ====== 0. helpers for i18n (fallback by browser lang) ======
const BROWSER_LANG = (navigator.language || 'en-US').toLowerCase();

function t(key) {
  const JA = {
    welcome: '欲しいものQを送ってください。例）「ノートPC 4万円台 軽い」「北京で食事」「2000元以内のスマホ」',
    placeholder: '商品や条件を入力...',
    voiceTitle: '音声で話す',
    sendTitle: '送信',
    linkOpen: '開く',
    priceUnknown: '価格不明',
    errServer: 'サーバーエラーです。',
    errFormat: 'フォーマットが想定と違います。',
    voiceNA: 'このブラウザでは音声入力が使えません。',
    listening: '🎤 聞いています...',
    voiceErr: '音声入力に失敗しました。',
    minimize: '最小化',
    restore: '復元',
    // ← これだけはもう使わない（入力言語で出すため）
    searching: '🔎 検索中です…'
  };
  const ZH = {
    welcome: '说一下你要买/要找的东西。例如：「约4000的轻薄本」「北京吃饭」「2000元以内的手机」。',
    placeholder: '输入商品或条件…',
    voiceTitle: '语音输入',
    sendTitle: '发送',
    linkOpen: '打开',
    priceUnknown: '价格不明',
    errServer: '服务端错误。',
    errFormat: '返回格式不符合预期。',
    voiceNA: '此浏览器不支持语音输入。',
    listening: '🎤 正在聆听…',
    voiceErr: '语音输入失败。',
    minimize: '最小化',
    restore: '还原',
    searching: '🔎 正在为你查找…'
  };
  const EN = {
    welcome: 'Tell me what you want. e.g. “lightweight laptop around $400”, “restaurant in Beijing”, “phone under 2000 CNY”.',
    placeholder: 'Type product or constraints…',
    voiceTitle: 'Speak',
    sendTitle: 'Send',
    linkOpen: 'Open',
    priceUnknown: 'Unknown price',
    errServer: 'Server error.',
    errFormat: 'Unexpected response format.',
    voiceNA: 'Voice input not available in this browser.',
    listening: '🎤 Listening...',
    voiceErr: 'Voice input failed.',
    minimize: 'Minimize',
    restore: 'Restore',
    searching: '🔎 Searching…'
  };
  const L = BROWSER_LANG.startsWith('ja')
    ? JA
    : BROWSER_LANG.startsWith('zh')
      ? ZH
      : EN;
  return L[key];
}

// ====== 1. per-input language detection (client-side) ======
// 入力テキストだけからその場でざっくり言語を当てる。
// これで「🔎 検索中…」をすぐ出す。後でサーバーがより正確に使うのは別。
function detectInputLangLocal(str) {
  if (!str) return 'en';

  // 日本語：ひらがな・カタカナがあればほぼ日本語
  if (/[ぁ-んァ-ン]/.test(str)) return 'ja';

  // ハングル
  if (/[\uac00-\ud7af]/.test(str)) return 'ko';

  // CJK漢字だけ（かな・ハングルはなし）→ 中国語寄せ
  // ※日本語でも漢字だけだとここに引っかかるが、日本語ユーザーは普通かなを混ぜるので許容
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(str)) return 'zh';

  // タイ語
  if (/[\u0E00-\u0E7F]/.test(str)) return 'th';

  // アラビア語
  if (/[\u0600-\u06FF]/.test(str)) return 'ar';

  // キリル（ロシア語など）
  if (/[\u0400-\u04FF]/.test(str)) return 'ru';

  // それ以外は英語扱い（後ろでサーバーが本物の言語を使う）
  return 'en';
}

// 入力言語に合わせて「検索中…」を出す
function searchingTextByInput(str) {
  const lang = detectInputLangLocal(str);
  if (lang === 'ja') return '🔎 検索中です…';
  if (lang === 'zh') return '🔎 正在为你查找…';
  if (lang === 'ko') return '🔎 검색 중입니다…';
  if (lang === 'th') return '🔎 กำลังค้นหา…';
  if (lang === 'ar') return '🔎 جارٍ البحث…';
  if (lang === 'ru') return '🔎 Идет поиск…';
  return '🔎 Searching…';
}

// ====== 2. panel layout ======
const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 420;

const panel = document.createElement('div');
panel.style.cssText = `
  position: fixed; top: 16px; right: 16px;
  width: ${PANEL_WIDTH}px; max-height: ${PANEL_HEIGHT}px;
  background: #111827; color: #ffffff;
  border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,.35);
  z-index: 999999; display: flex; flex-direction: column;
  overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  border: 1px solid rgba(255,255,255,.04);
`;
document.body.appendChild(panel);

panel.innerHTML = `
  <div style="
    height:44px; display:flex; align-items:center; justify-content:space-between;
    padding:0 12px; border-bottom:1px solid rgba(255,255,255,.05);
    background: rgba(17,24,39,0.85); backdrop-filter: blur(4px);
  ">
    <div style="display:flex; gap:6px; align-items:center;">
      <div style="width:20px;height:20px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;font-size:12px;">AI</div>
      <div style="font-size:13px;font-weight:600;">AI Commerce Bot</div>
    </div>
    <button id="aic-minimize" style="
      background:transparent; border:none; color:#fff; font-size:16px;
      cursor:pointer; opacity:.55;
    " title="${t('minimize')}">–</button>
  </div>
  <div id="aic-messages" style="
    flex:1; min-height:0;
    overflow-y:auto;
    overscroll-behavior:contain;
    padding:10px; display:flex; flex-direction:column; gap:6px;
  "></div>
  <div style="display:flex; gap:6px; padding:8px 10px; border-top:1px solid rgba(255,255,255,.05); background:#0f172a;">
    <input id="aic-input" placeholder="${t('placeholder')}" autocomplete="off" style="
      flex:1; background:#0f172a; border:1px solid rgba(255,255,255,.03);
      border-radius:8px; padding:6px 8px; color:#fff; font-size:13px;">
    <button id="aic-voice" style="
      width:32px; height:32px; border-radius:8px; border:none;
      background:rgba(15,118,110,0.12); color:#fff; cursor:pointer;
      display:flex; align-items:center; justify-content:center; font-size:15px;
    " title="${t('voiceTitle')}">🎤</button>
    <button id="aic-send" style="
      width:32px; height:32px; border-radius:8px; border:none; background:#10b981;
      color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:15px;
    " title="${t('sendTitle')}">→</button>
  </div>
`;

const msgBox = panel.querySelector('#aic-messages');
const inputEl = panel.querySelector('#aic-input');
const sendBtn = panel.querySelector('#aic-send');
const voiceBtn = panel.querySelector('#aic-voice');
const minimizeBtn = panel.querySelector('#aic-minimize');

// スクロールがページに伝播しないようにする
msgBox.addEventListener(
  'wheel',
  e => {
    const el = msgBox;
    const delta = e.deltaY;
    const atTop = el.scrollTop === 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((delta < 0 && atTop) || (delta > 0 && atBottom)) return;
    e.preventDefault();
    e.stopPropagation();
    el.scrollTop += delta;
  },
  { passive: false }
);

// 初回メッセージ
addBotText(t('welcome'));

// ====== 3. UI helpers ======
function addUserBubble(text) {
  const div = document.createElement('div');
  div.style.alignSelf = 'flex-end';
  div.style.maxWidth = '78%';
  div.style.background = '#10b981';
  div.style.borderRadius = '12px 12px 2px 12px';
  div.style.padding = '6px 10px';
  div.style.fontSize = '13px';
  div.style.wordBreak = 'break-word';
  div.textContent = text;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
  return div;
}

function addBotText(text) {
  const div = document.createElement('div');
  div.style.alignSelf = 'flex-start';
  div.style.maxWidth = '100%';
  div.style.background = 'rgba(255,255,255,.04)';
  div.style.borderRadius = '12px 12px 12px 2px';
  div.style.padding = '6px 10px';
  div.style.fontSize = '13px';
  div.style.wordBreak = 'break-word';
  div.textContent = text;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
  return div;
}

function addProductCards(items = []) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '6px';
  wrap.style.alignSelf = 'stretch';
  wrap.style.width = '100%';

  items.forEach(it => {
    const card = document.createElement('div');
    card.style.background = 'rgba(255,255,255,.02)';
    card.style.border = '1px solid rgba(255,255,255,.06)';
    card.style.borderRadius = '10px';
    card.style.padding = '6px 8px';
    card.style.display = 'flex';
    card.style.gap = '10px';
    card.style.width = '100%';
    card.style.boxSizing = 'border-box';
    card.style.alignItems = 'center';

    const thumb = document.createElement('div');
    thumb.style.width = '56px';
    thumb.style.height = '56px';
    thumb.style.flex = '0 0 56px';
    thumb.style.borderRadius = '8px';
    thumb.style.overflow = 'hidden';
    thumb.style.background = 'rgba(15,23,42,.35)';
    thumb.style.display = 'flex';
    thumb.style.alignItems = 'center';
    thumb.style.justifyContent = 'center';
    thumb.style.fontSize = '11px';
    thumb.style.textAlign = 'center';

    if (it.image) {
      const img = document.createElement('img');
      img.src = it.image;
      img.alt = it.title || '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      thumb.appendChild(img);
    } else {
      thumb.textContent = 'No Image';
    }

    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `
      <div style="font-weight:600;font-size:13px;line-height:1.25;">${it.title || ''}</div>
      ${it.description ? `<div style="font-size:12px;opacity:.75;margin-top:2px;">${it.description}</div>` : ''}
      <div style="font-size:12px;opacity:.8;margin-top:2px;">
        ${it.price ? it.price : t('priceUnknown')}${it.source ? ` · ${it.source}` : ''}
      </div>
      ${it.url
        ? `<a href="${it.url}" target="_blank" style="font-size:11px;color:#22d3ee;text-decoration:none;margin-top:4px;display:inline-block;">${t(
          'linkOpen'
        )}</a>`
        : ''
      }
    `;

    card.appendChild(thumb);
    card.appendChild(info);
    wrap.appendChild(card);
  });

  msgBox.appendChild(wrap);
  msgBox.scrollTop = msgBox.scrollHeight;
}

// ====== 4. send message (text) ======
async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  addUserBubble(text);
  inputEl.value = '';

  // 入力言語で「検索中…」
  const loading = addBotText(searchingTextByInput(text));

  chrome.runtime.sendMessage(
    {
      type: 'AI_CHAT',
      payload: {
        text,
        // 今回は“ユーザーが入力した言語”を優先してサーバーに渡す
        lang: detectInputLangLocal(text),
        siteHost: location.hostname || ''
      }
    },
    resp => {
      if (loading && loading.remove) loading.remove();

      if (!resp || !resp.ok) return addBotText(t('errServer'));
      const data = resp.data;
      if (!data || !Array.isArray(data.messages)) return addBotText(t('errFormat'));

      data.messages.forEach(m => {
        if (m.type === 'text') addBotText(m.content);
        if (m.type === 'products') addProductCards(m.items);
      });
    }
  );
}

sendBtn.onclick = sendMessage;
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});
// ====== 5. voice input ======
let isRecording = false;
let currentRecorder = null;
let currentStream = null;
let recordTimeoutId = null;

voiceBtn.onclick = async () => {
  // すでに録音中なら「停止」として扱う
  if (isRecording) {
    stopRecordingManually();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    addBotText(t('voiceNA'));
    return;
  }

  // 録音開始
  addBotText(t('listening'));
  isRecording = true;
  voiceBtn.textContent = '■';          // ボタンの見た目を「停止」っぽく
  voiceBtn.title = 'Stop';

  // 6秒くらい録る
  const MAX_MS = 6000;

  currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  currentRecorder = new MediaRecorder(currentStream);
  const chunks = [];
  currentRecorder.ondataavailable = e => chunks.push(e.data);

  currentRecorder.onstop = async () => {
    // ここに来たらもう録音は終わり
    clearRecordingState();

    const blob = new Blob(chunks, { type: 'audio/webm' });
    // Blob -> base64
    const audioBase64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl = fr.result;
        resolve(String(dataUrl).split(',')[1] || '');
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });

    if (!audioBase64) {
      addBotText(t('voiceErr'));
      return;
    }

    // STT に投げる
    const sttResp = await fetch('https://ergonomics-mu.vercel.app/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, mimeType: blob.type || 'audio/webm' })
    }).catch(() => null);

    const stt = sttResp ? await sttResp.json().catch(() => null) : null;
    if (!stt || !stt.ok || !stt.text) {
      addBotText(t('voiceErr'));
      return;
    }

    // 文字起こしを表示して、その言語で「検索中…」
    addUserBubble(stt.text);
    const loading = addBotText(searchingTextByInput(stt.text));

    chrome.runtime.sendMessage(
      {
        type: 'AI_CHAT',
        payload: {
          text: stt.text,
          lang: stt.lang || detectInputLangLocal(stt.text),
          siteHost: location.hostname || ''
        }
      },
      resp => {
        if (loading && loading.remove) loading.remove();

        if (!resp || !resp.ok) return addBotText(t('errServer'));
        const data = resp.data;
        if (!data || !Array.isArray(data.messages)) return addBotText(t('errFormat'));

        data.messages.forEach(m => {
          if (m.type === 'text') addBotText(m.content);
          if (m.type === 'products') addProductCards(m.items);
        });
      }
    );
  };

  currentRecorder.start();

  // 自動停止タイマー
  recordTimeoutId = setTimeout(() => {
    if (currentRecorder && currentRecorder.state === 'recording') {
      currentRecorder.stop();
    }
  }, MAX_MS);
};

// 手動停止用
function stopRecordingManually() {
  if (currentRecorder && currentRecorder.state === 'recording') {
    currentRecorder.stop();
  } else {
    clearRecordingState();
  }
}

function clearRecordingState() {
  isRecording = false;
  voiceBtn.textContent = '🎤';
  voiceBtn.title = t('voiceTitle');

  if (recordTimeoutId) {
    clearTimeout(recordTimeoutId);
    recordTimeoutId = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach(tr => tr.stop());
    currentStream = null;
  }
  currentRecorder = null;
}

// ====== 6. minimize ======
let minimized = false;
minimizeBtn.onclick = () => {
  minimized = !minimized;
  const footer = inputEl.parentElement;
  if (minimized) {
    msgBox.style.display = 'none';
    footer.style.display = 'none';
    panel.style.height = '44px';
    panel.style.maxHeight = '44px';
    minimizeBtn.textContent = '▣';
    minimizeBtn.title = t('restore');
  } else {
    msgBox.style.display = 'flex';
    footer.style.display = 'flex';
    panel.style.height = '';
    panel.style.maxHeight = `${PANEL_HEIGHT}px`;
    minimizeBtn.textContent = '–';
    minimizeBtn.title = t('minimize');
  }
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AIC_RUN_SEARCH') {
    const kw = (msg.kw || '').trim();
    if (!kw) return;

    // 入力欄に入れて既存の送信処理を流用
    inputEl.value = kw;

    // provider を使いたいなら、payload に含めるよう sendMessage を拡張してもOK
    // （※ /api/chatbot が provider を受け取れるようにした場合）
    sendMessage();
  }

  if (msg.type === 'AIC_TOGGLE_PANEL') {
    // 既存の minimize と同様のトグル関数があるなら呼ぶ
    // なければ簡易に表示/非表示を切り替える処理を入れる
    panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
  }
});
