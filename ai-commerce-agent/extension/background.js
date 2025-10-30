// extension/background.js
console.log('[AIC] BG loaded');

const BASE_URL = 'https://ergonomics-mu.vercel.app/api'; // ←ここを固定

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'AI_CHAT') {
    fetch(`${BASE_URL}/chatbot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.payload),
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }
});
