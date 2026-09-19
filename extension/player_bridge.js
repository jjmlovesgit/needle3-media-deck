window.addEventListener("message", async event => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== "karaoke-player"
  ) return;

  if (event.data?.type === "speech-diagnostic") {
    chrome.runtime.sendMessage({
      type: "speech_diagnostic",
      message: String(event.data.message || "").slice(0, 1000),
    }).catch(() => {});
    return;
  }

  if (event.data?.type === "player-diagnostic") {
    chrome.runtime.sendMessage({
      type: "player_diagnostic",
      channel: String(event.data.channel || "player").replace(/[^a-z0-9_-]/gi, "").slice(0, 24),
      message: String(event.data.message || "").slice(0, 1000),
    }).catch(() => {});
    return;
  }

  if (event.data?.type !== "toggle-extension-side-panel") return;

  try {
    const result = await chrome.runtime.sendMessage({type: "toggle_extension_side_panel"});
    window.postMessage({
      source: "karaoke-extension",
      type: "extension-side-panel-state",
      open: Boolean(result?.open),
      error: result?.error || "",
    }, window.location.origin);
  } catch (error) {
    window.postMessage({
      source: "karaoke-extension",
      type: "extension-side-panel-state",
      open: false,
      error: error.message,
    }, window.location.origin);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "media_deck_push_to_talk") return false;
  const action = message.action === "down" ? "down" : message.action === "up" ? "up" : "";
  if (!action) {
    sendResponse({ok: false});
    return false;
  }
  window.postMessage({
    source: "karaoke-extension",
    type: "media-deck-ptt",
    action,
  }, window.location.origin);
  sendResponse({ok: true});
  return false;
});
