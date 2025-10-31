// extension/content.js
// AI Commerce Bot – top-right fixed, auto-lang + i18n
console.log('[AIC] content v1.3 loaded');

const USER_LANG = (navigator.language || 'en-US').toLowerCase();

// ---- i18n ----
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
    restore: '復元'
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
    restore: '还原'
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
    restore: 'Restore'
  };
  const L = USER_LANG.startsWith('ja') ? JA : USER_LANG.startsWith('zh') ? ZH : EN;
  return L[key];
}

// ---- layout ----
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
  <div id="aic-messages" style="flex:1; padding:10px; display:flex; flex-direction:column; gap:6px; overflow-y:auto;"></div>
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

// 初回メッセージ
addBotText(t('welcome'));

// ---- UI helpers ----
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
}

function addBotText(text) {
  const div = document.createElement('div');
  div.style.alignSelf = 'flex-start';
  div.style.maxWidth = '85%';
  div.style.background = 'rgba(255,255,255,.04)';
  div.style.borderRadius = '12px 12px 12px 2px';
  div.style.padding = '6px 10px';
  div.style.fontSize = '13px';
  div.style.wordBreak = 'break-word';
  div.textContent = text;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function addProductCards(items = []) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '5px';
  wrap.style.alignSelf = 'flex-start';
  items.forEach(it => {
    const card = document.createElement('div');
    card.style.background = 'rgba(255,255,255,.02)';
    card.style.border = '1px solid rgba(255,255,255,.02)';
    card.style.borderRadius = '10px';
    card.style.padding = '5px 7px';
    card.innerHTML = `
      <div style="font-weight:600;font-size:13px;line-height:1.2;">${it.title}</div>
      <div style="font-size:12px;opacity:.65;margin:2px 0 4px;">${it.price ? '¥' + it.price : t('priceUnknown')}</div>
      ${it.url ? `<a href="${it.url}" target="_blank" style="font-size:11px;color:#22d3ee;text-decoration:none;">${t('linkOpen')}</a>` : ''}
    `;
    wrap.appendChild(card);
  });
  msgBox.appendChild(wrap);
  msgBox.scrollTop = msgBox.scrollHeight;
}

// ---- send ----
function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  addUserBubble(text);
  inputEl.value = '';

  chrome.runtime.sendMessage(
    { type: 'AI_CHAT', payload: { text, lang: navigator.language || 'en-US', provider: 'jd' } },
    resp => {
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
inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(); });

// ---- voice ----
// 音声を録って /api/stt に丸投げして、返ってきた text/lang を /chatbot に送る
voiceBtn.onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { addBotText(t('voiceNA')); return; }
  addBotText(t('listening'));

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.start();

  // 3～5秒だけ録音（好みで調整）
  await new Promise(r => setTimeout(r, 3500));
  rec.stop();
  await new Promise(r => rec.onstop = r);
  stream.getTracks().forEach(tr => tr.stop());

  const blob = new Blob(chunks, { type: 'audio/webm' });
  const fd = new FormData();
  fd.set('audio', blob, 'voice.webm');

  // VercelのSTTへ
  const sttResp = await fetch('https://ergonomics-mu.vercel.app/api/stt', { method: 'POST', body: fd });
  const stt = await sttResp.json();
  if (!stt.ok || !stt.text) { addBotText(t('voiceErr')); return; }

  // 文字起こし結果を即送信
  inputEl.value = stt.text;
  addUserBubble(stt.text);
  chrome.runtime.sendMessage(
    { type: 'AI_CHAT', payload: { text: stt.text, lang: stt.lang || (navigator.language || 'en-US'), provider: 'jd' } },
    resp => {
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


// ---- minimize ----
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
