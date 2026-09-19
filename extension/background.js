async function enableSidePanel() {
  try {
    await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true});
  } catch (error) {
    console.error("Could not enable the karaoke side panel", error);
  }
}
chrome.runtime.onInstalled.addListener(enableSidePanel);
chrome.runtime.onStartup.addListener(enableSidePanel);
chrome.action.onClicked.addListener(async tab => {
  if (tab?.windowId) await chrome.sidePanel.open({windowId: tab.windowId});
});

const openPanelWindows = new Set();

chrome.sidePanel.onOpened.addListener(info => {
  openPanelWindows.add(info.windowId);
});

chrome.sidePanel.onClosed.addListener(info => {
  openPanelWindows.delete(info.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "toggle_extension_side_panel") return false;
  const windowId = sender.tab?.windowId;
  if (!windowId) {
    sendResponse({ok: false, open: false, error: "Player tab window was not available."});
    return false;
  }
  (async () => {
    try {
      if (openPanelWindows.has(windowId)) {
        await chrome.sidePanel.close({windowId});
        openPanelWindows.delete(windowId);
        sendResponse({ok: true, open: false});
      } else {
        await chrome.sidePanel.open({windowId});
        openPanelWindows.add(windowId);
        sendResponse({ok: true, open: true});
      }
    } catch (error) {
      sendResponse({ok: false, open: openPanelWindows.has(windowId), error: error.message});
    }
  })();
  return true;
});
