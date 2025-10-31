// extension/background.js
console.log('[AIC] BG loaded');

const BASE_URL = 'https://ergonomics-mu.vercel.app/api';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // チャット
  if (msg.type === 'AI_CHAT') {
    fetch(`${BASE_URL}/chatbot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload),
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }

  // 言語判定だけしたいとき
  if (msg.type === 'AIC_DETECT_LANG') {
    fetch(`${BASE_URL}/lang-detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: msg.text || '' }),
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // async
  }
});
