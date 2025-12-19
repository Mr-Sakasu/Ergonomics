// extension/background.js
console.log('[AIC] BG loaded');

const API_BASE = 'https://ergonomics-mu.vercel.app/api';
const DEFAULT_TIMEOUT_MS = 12000;

function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

chrome.runtime.onInstalled.addListener(() => {
    // Open side panel when user clicks extension action button
    if (chrome.sidePanel?.setPanelBehavior) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
});

function normalizeScriptErrorMessage(msg = '') {
    const s = String(msg || '');

    if (s.includes('Cannot access a chrome:// URL')) return 'restricted_chrome_url';
    if (s.includes('The extensions gallery cannot be scripted')) return 'restricted_webstore';
    if (s.includes('Cannot access contents of the page')) return 'cannot_access_page';
    if (s.includes('Extension manifest must request permission')) return 'missing_host_permission';

    return s || 'unknown_error';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    // ---------- AI chat ----------
    if (msg.type === 'AI_CHAT') {
        fetchWithTimeout(`${API_BASE}/chatbot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(msg.payload || {}),
        })
            .then(r => r.json())
            .then(data => sendResponse({ ok: true, data }))
            .catch(err => sendResponse({ ok: false, error: String(err?.name || err) }));
        return true;
    }

    // ---------- lang detect ----------
    if (msg.type === 'AIC_DETECT_LANG') {
        fetchWithTimeout(`${API_BASE}/lang-detect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: msg.text || '' }),
        })
            .then(r => r.json())
            .then(data => sendResponse({ ok: true, data }))
            .catch(err => sendResponse({ ok: false, error: String(err?.name || err) }));
        return true;
    }

    // ---------- Voice: forward results from injected recorder ----------
    if (msg.type === 'AIC_VOICE_RESULT') {
        if (msg._forwarded) return;
        chrome.runtime.sendMessage({ ...msg, _forwarded: true });
        return;
    }

    // ---------- Voice: start recording INSIDE the active tab ----------
    if (msg.type === 'AIC_VOICE_START') {
        const { tabId, maxMs = 6000, sessionId = '' } = msg.payload || {};
        if (!tabId) {
            sendResponse({ ok: false, error: 'tabId_missing' });
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId },
                args: [Number(maxMs || 6000), String(sessionId || '')],
                func: async (MAX_MS, SESSION) => {
                    const sendResult = (payload) => {
                        try {
                            chrome.runtime.sendMessage({
                                type: 'AIC_VOICE_RESULT',
                                sessionId: SESSION,
                                siteHost: location.hostname || '',
                                pageUrl: location.href || '',
                                title: document.title || '',
                                ...payload,
                            });
                        } catch (_) { }
                    };

                    const blobToBase64 = async (blob) =>
                        await new Promise((resolve, reject) => {
                            const fr = new FileReader();
                            fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
                            fr.onerror = reject;
                            fr.readAsDataURL(blob);
                        });

                    const cleanup = () => {
                        try {
                            if (globalThis.__aicVoice?.stream) {
                                globalThis.__aicVoice.stream.getTracks().forEach((t) => t.stop());
                            }
                        } catch (_) { }
                        globalThis.__aicVoice = null;
                    };

                    if (globalThis.__aicVoice && globalThis.__aicVoice.state === 'recording') {
                        return { ok: true, already: true };
                    }

                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

                        const recorder = new MediaRecorder(stream);
                        const chunks = [];

                        globalThis.__aicVoice = {
                            state: 'recording',
                            recorder,
                            stream,
                            stop: () => {
                                try {
                                    if (recorder.state === 'recording') recorder.stop();
                                } catch (_) { }
                            },
                        };

                        recorder.ondataavailable = (ev) => {
                            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
                        };

                        recorder.onerror = () => {
                            sendResult({ ok: false, error: 'recorder_error' });
                            cleanup();
                        };

                        recorder.onstop = async () => {
                            try {
                                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                                const audioBase64 = await blobToBase64(blob);
                                sendResult({
                                    ok: true,
                                    audioBase64,
                                    mimeType: blob.type || 'audio/webm',
                                });
                            } catch (e) {
                                sendResult({ ok: false, error: String(e?.name || e) });
                            } finally {
                                cleanup();
                            }
                        };

                        recorder.start();

                        setTimeout(() => {
                            try {
                                if (globalThis.__aicVoice?.recorder?.state === 'recording') {
                                    globalThis.__aicVoice.stop();
                                }
                            } catch (_) { }
                        }, MAX_MS);

                        return { ok: true };
                    } catch (e) {
                        sendResult({ ok: false, error: String(e?.name || e) });
                        cleanup();
                        return { ok: false, error: String(e?.name || e) };
                    }
                },
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: normalizeScriptErrorMessage(chrome.runtime.lastError.message) });
                    return;
                }
                sendResponse({ ok: true, data: results?.[0]?.result || {} });
            }
        );

        return true;
    }

    // ---------- Voice: stop recording inside tab ----------
    if (msg.type === 'AIC_VOICE_STOP') {
        const { tabId } = msg.payload || {};
        if (!tabId) {
            sendResponse({ ok: false, error: 'tabId_missing' });
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: () => {
                    try {
                        if (globalThis.__aicVoice?.stop) {
                            globalThis.__aicVoice.stop();
                            return { ok: true };
                        }
                        return { ok: true, noRecorder: true };
                    } catch (e) {
                        return { ok: false, error: String(e?.name || e) };
                    }
                },
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: normalizeScriptErrorMessage(chrome.runtime.lastError.message) });
                    return;
                }
                sendResponse({ ok: true, data: results?.[0]?.result || {} });
            }
        );

        return true;
    }
});
