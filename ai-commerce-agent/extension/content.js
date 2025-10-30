// content.js - chat UI version
(function () {
  console.log('[AIC] chat ui loaded');
  const fab = document.createElement('div');
  fab.id = 'aic-fab';
  fab.textContent = '💬';
  fab.style.cssText = 'position:fixed; right:16px; bottom:16px; width:48px; height:48px; background:#4b8; color:#001; border-radius:999px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:999999; font-size:22px; box-shadow:0 10px 30px rgba(0,0,0,.3);';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'aic-chat';
  panel.style.cssText = 'position:fixed; right:16px; bottom:72px; width:320px; max-height:420px; background:#0d0d0d; border:1px solid #222; border-radius:18px; display:none; flex-direction:column; z-index:999999; box-shadow:0 10px 30px rgba(0,0,0,.45); font-family:system-ui; color:#fff;';
  panel.innerHTML = `
    <div style="padding:8px 10px; border-bottom:1px solid #222; display:flex; gap:6px; align-items:center;">
      <div style="flex:1; font-weight:600;">AI Commerce Bot</div>
      <select id="aic-lang" style="background:#000; color:#fff; border:1px solid #444; border-radius:6px; padding:2px 4px;">
        <option value="ja-JP">日本語</option>
        <option value="zh-CN">中文</option>
        <option value="en-US">English</option>
      </select>
    </div>
    <div id="aic-msgs" style="flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:6px;"></div>
    <div style="padding:8px 10px; border-top:1px solid #222; display:flex; gap:6px;">
      <input id="aic-input" placeholder="メッセージを入力..." style="flex:1; background:#000; color:#fff; border:1px solid #444; border-radius:10px; padding:6px 8px;">
      <button id="aic-voice" style="background:#333; border:none; border-radius:10px; padding:4px 6px;">🎤</button>
      <button id="aic-send" style="background:#4b8; border:none; border-radius:10px; padding:4px 10px; font-weight:600;">→</button>
    </div>
  `;
  document.body.appendChild(panel);

  fab.onclick = () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  };

  const msgs = panel.querySelector('#aic-msgs');
  const input = panel.querySelector('#aic-input');
  const sendBtn = panel.querySelector('#aic-send');
  const voiceBtn = panel.querySelector('#aic-voice');
  const langSel = panel.querySelector('#aic-lang');

  function addUserBubble(text) {
    const div = document.createElement('div');
    div.style.alignSelf = 'flex-end';
    div.style.background = '#4b8';
    div.style.color = '#001';
    div.style.padding = '6px 10px';
    div.style.borderRadius = '12px';
    div.style.maxWidth = '85%';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addBotBubble(text) {
    const div = document.createElement('div');
    div.style.alignSelf = 'flex-start';
    div.style.background = '#1a1a1a';
    div.style.padding = '6px 10px';
    div.style.borderRadius = '12px';
    div.style.maxWidth = '90%';
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function addProductList(items) {
    items.forEach(it => {
      const card = document.createElement('div');
      card.style.background = '#131313';
      card.style.border = '1px solid #333';
      card.style.borderRadius = '10px';
      card.style.padding = '6px 8px';
      card.style.marginBottom = '4px';
      card.innerHTML = `
        <div style="font-weight:600;">${it.title}</div>
        <div style="font-size:12px; opacity:.7;">¥${it.price}</div>
        ${it.url ? `<a href="${it.url}" target="_blank" style="font-size:12px; color:#4b8;">ページを開く</a>` : ''}
      `;
      msgs.appendChild(card);
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    const lang = langSel.value;
    addUserBubble(text);
    input.value = '';

    chrome.runtime.sendMessage({
      type: 'AI_CHAT',
      payload: { text, lang, provider: 'jd' }
    }, (res) => {
      if (!res || !res.ok) {
        addBotBubble('サーバーエラーです。');
        return;
      }
      const data = res.data;
      (data.messages || []).forEach(m => {
        if (m.type === 'text') addBotBubble(m.content);
        if (m.type === 'products') addProductList(m.items || []);
      });
    });
  }

  sendBtn.onclick = sendMessage;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  voiceBtn.onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      addBotBubble('このブラウザでは音声が使えません');
      return;
    }
    const rec = new SR();
    rec.lang = langSel.value || 'ja-JP';
    rec.start();
    addBotBubble('🎤 聞き取り中...');
    rec.onresult = (ev) => {
      const heard = ev.results[0][0].transcript;
      input.value = heard;
      sendMessage();
    };
    rec.onerror = () => {
      addBotBubble('音声がうまく取れませんでした');
    };
  };
})();
