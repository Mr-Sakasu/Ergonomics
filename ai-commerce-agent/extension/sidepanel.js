// ===== Voice input (sidepanel) =====
let voiceMetaBubble = null;

function setMicRecordingUI(on) {
    state.recording = !!on;
    if (state.recording) {
        el.btnMic.classList.add("recording");
        el.btnMic.textContent = "■";
    } else {
        el.btnMic.classList.remove("recording");
        el.btnMic.textContent = "🎤";
    }
}

function showVoiceError(errCode = "") {
    const s = String(errCode || "");
    if (s.includes("NotAllowedError")) return addMeta(t("voiceDenied"));
    if (s === "restricted_chrome_url" || s === "restricted_webstore") return addMeta(t("voiceNeedPage"));
    if (s === "cannot_access_page" || s === "missing_host_permission") return addMeta(t("voiceNoPermission"));
    return addMeta(`${t("voiceOther")}\n${s}`);
}

el.btnMic.addEventListener("click", async () => {
    // 1) Active tab を更新（失敗しても落ちないように）
    await refreshHeader(true).catch(() => null);

    const tabId = state.active.tabId;
    const pageUrl = state.active.url || "";

    // 通常Webページでのみ録音（getUserMedia が https 前提）
    if (!tabId || !state.active.accessible) {
        addMeta(t("voiceNeedPage"));
        return;
    }
    if (!/^https:\/\//i.test(pageUrl)) {
        addMeta(t("voiceNeedHttps"));
        return;
    }

    // 録音中なら停止
    if (state.recording) {
        setMicRecordingUI(false);
        try { await chrome.runtime.sendMessage({ type: "AIC_VOICE_STOP", payload: { tabId } }); } catch { }
        return;
    }

    // 録音開始
    const sessionId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    state.voiceSession = sessionId;

    setMicRecordingUI(true);
    voiceMetaBubble = addMeta(t("listening"));

    let resp = null;
    try {
        resp = await chrome.runtime.sendMessage({
            type: "AIC_VOICE_START",
            payload: { tabId, maxMs: 6500, sessionId }
        });
    } catch (e) {
        setMicRecordingUI(false);
        if (voiceMetaBubble?.remove) voiceMetaBubble.remove();
        voiceMetaBubble = null;
        showVoiceError(String(e?.message || e));
        return;
    }

    // executeScript 自体が失敗（権限や chrome:// など）
    if (!resp || resp.ok === false) {
        setMicRecordingUI(false);
        if (voiceMetaBubble?.remove) voiceMetaBubble.remove();
        voiceMetaBubble = null;
        showVoiceError(resp?.error || "");
        return;
    }

    // ページ内 getUserMedia が失敗している場合（NotAllowedError 等）
    if (resp?.data && resp.data.ok === false) {
        setMicRecordingUI(false);
        if (voiceMetaBubble?.remove) voiceMetaBubble.remove();
        voiceMetaBubble = null;
        showVoiceError(resp.data.error || "");
        return;
    }
});

// injected recorder から結果が来る
chrome.runtime.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== "AIC_VOICE_RESULT") return;
    if (msg.sessionId !== state.voiceSession) return;

    // UI reset
    setMicRecordingUI(false);
    if (voiceMetaBubble?.remove) voiceMetaBubble.remove();
    voiceMetaBubble = null;

    if (!msg.ok) {
        showVoiceError(msg.error || "");
        return;
    }

    // STT（背景経由）
    const sttResp = await chrome.runtime.sendMessage({
        type: "AIC_STT",
        payload: { audioBase64: msg.audioBase64, mimeType: msg.mimeType }
    }).catch(() => null);

    const stt = sttResp?.data;
    if (!stt || !stt.ok || !stt.text) {
        addMeta(t("voiceOther"));
        return;
    }

    // 文字起こしをそのまま検索へ
    await sendChat(stt.text);
});
