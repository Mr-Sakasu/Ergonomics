// extension/content.js
console.log('[AIC] content v1.1 loaded');

const W = 320;

const btn = document.createElement('div');
btn.textContent = '💬';
btn.style.cssText = `
  position: fixed; right: 20px; bottom: 20px;
  width: 48px; height: 48px; border-radius: 50%;
  background: #10b981; color: #fff; font-size: 24px;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer; z-index: 999999;
`;
document.body.appendChild(btn);

const panel = document.createElement('div');
panel.style.cssText = `
  position: fixed; right: 20px; bottom: 80px;
  width: ${W}px; max-height: 420px;
  background: #1f2937; color: #fff;
  border-radius: 14px; box-shadow: 0 8px 20px rgba(0,0,0,.25);
  display: none; flex-direction: column;
  z-index: 999999;
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI";
`;
document.body.appendChild(panel);

panel.innerHTML = `
  <div style="padding:10px 12px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,.08);">
    <span style="font-weight:600;">AI Commerce Bot</span>
    <select id="aic-lang" style="background:#111; color:#fff; border:1px solid rgba(255,255,255,.1); border-radius:6px; font-size:12px; padding:2px 6px;">
      <option value="ja-JP">日本語</option>
      <option value="zh-CN">中文</option>
      <option value="en-US">English</option>
    </select>
  </div>
  <div id="aic-messages" style="flex:1; padding:8px 10px; overflow-y:auto; display:flex; flex-direction:column; gap:6px;"></div>
  <div style="display:flex; gap:6px; padding:8px 10px; border-top:1px solid rgba(255,255,255,.08);">
    <input id="aic-input" placeholder="メッセージを入力..." style="flex:1; background:#111827; border:none; outline:none; padding:6px 8px; border-radius:6px; color:#fff; font-size:13px;">
    <button id="aic-send" style="background:#10b981; border:none; color:#fff; padding:6px 8px; border-radius:6px; cursor:pointer;">→</button>
  </div>
`;

const msgBox = panel.querySelector('#aic-messages');
const langSel = panel.querySelector('#aic-lang');
const inputEl = panel.querySelector('#aic-input');
const sendBtn = panel.querySelector('#aic-send');

btn.onclick = () => {
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
};

function addUserBubble(text) {
  const div = document.createElement('div');
  div.style.alignSelf = 'flex-end';
  div.style.maxWidth = '80%';
  div.style.padding = '6px 10px';
  div.style.background = '#10b981';
  div.style.borderRadius = '10px 10px 0 10px';
  div.style.fontSize = '13px';
  div.textContent = text;
  msgBox.appendChild(div);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function addBotText(text) {
  const div = document.createElement('div');
  div.style.alignSelf = 'flex-start';
  div.style.maxWidth = '85%';
  div.style.padding = '6px 10px';
  div.style.background = 'rgba(255,255,255,.05)';
  div.style.borderRadius = '10px 10px 10px 0';
  div.style.fontSize = '13px';
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
    card.style.background = 'rgba(255,255,255,.03)';
    card.style.border = '1px solid rgba(255,255,255,.03)';
    card.style.borderRadius = '8px';
    card.style.padding = '5px 7px';
    card.innerHTML = `
      <div style="font-weight:600; font-size:13px;">${it.title}</div>
      <div style="font-size:12px; opacity:.7;">¥${it.price ?? '---'}</div>
      ${it.url ? `<a href="${it.url}" target="_blank" style="font-size:11px; color:#22d3ee;">開く</a>` : ''}
    `;
    wrap.appendChild(card);
  });
  msgBox.appendChild(wrap);
  msgBox.scrollTop = msgBox.scrollHeight;
}

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  addUserBubble(text);
  inputEl.value = '';
  const lang = langSel.value || 'ja-JP';

  chrome.runtime.sendMessage(
    {
      type: 'AI_CHAT',
      payload: {
        text,
        lang,
        provider: 'jd'
      }
    },
    (resp) => {
      if (!resp || !resp.ok) {
        addBotText('サーバーエラーです。');
        return;
      }
      const data = resp.data;
      if (!data || !Array.isArray(data.messages)) {
        addBotText('フォーマットが想定と違います。');
        return;
      }
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
