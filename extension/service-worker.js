importScripts("lib/focus-policy.js");

const OFFSCREEN_PATH = "offscreen.html";
const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.7,
};
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

let creatingOffscreenDocument = null;
let dedupeQueue = Promise.resolve();

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  let exists = false;

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    exists = contexts.length > 0;
  } else {
    const matchedClients = await clients.matchAll();
    exists = matchedClients.some((client) => client.url === offscreenUrl);
  }

  if (exists) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play the user-selected completion melody.",
      })
      .finally(() => {
        creatingOffscreenDocument = null;
      });
  }

  await creatingOffscreenDocument;
}

async function playSound(volume) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "PLAY_SOUND",
    volume,
  });
  if (!response || !response.played) {
    throw new Error("Audio playback failed.");
  }
}

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

function markCompletionOnce(completionId) {
  const operation = dedupeQueue.then(async () => {
    const now = Date.now();
    const stored = await chrome.storage.session.get({
      recentCompletions: [],
    });
    const recent = stored.recentCompletions.filter(
      (entry) => now - entry.at < DEDUPE_WINDOW_MS,
    );

    if (recent.some((entry) => entry.id === completionId)) {
      return false;
    }

    recent.push({ at: now, id: completionId });
    await chrome.storage.session.set({
      recentCompletions: recent.slice(-100),
    });
    return true;
  });

  dedupeQueue = operation.catch(() => {});
  return operation;
}

function isSupportedSender(sender) {
  if (!sender.tab || typeof sender.tab.id !== "number") {
    return false;
  }

  try {
    const hostname = new URL(sender.url).hostname;
    return hostname === "chatgpt.com" || hostname === "claude.ai";
  } catch {
    return false;
  }
}

async function handleCompletion(message, sender) {
  if (
    !isSupportedSender(sender) ||
    typeof message.completionId !== "string" ||
    message.completionId.length > 500
  ) {
    return { played: false, reason: "invalid-message" };
  }

  const settings = await getSettings();
  if (!settings.enabled) {
    return { played: false, reason: "disabled" };
  }

  if (!(await markCompletionOnce(message.completionId))) {
    return { played: false, reason: "duplicate" };
  }

  try {
    const tab = await chrome.tabs.get(sender.tab.id);
    const window = await chrome.windows.get(tab.windowId);
    const shouldPlay =
      globalThis.WashingMachineChimeFocusPolicy.shouldPlayForPage({
        pageVisible: message.pageVisible,
        tabActive: tab.active,
        windowFocused: window.focused,
      });

    if (!shouldPlay) {
      return { played: false, reason: "page-active" };
    }

    const volume = Math.min(1, Math.max(0, Number(settings.volume) || 0));
    await playSound(volume);
    return { played: true };
  } catch {
    // If focus cannot be verified, fail closed so an active conversation
    // never makes noise unexpectedly.
    return { played: false, reason: "focus-unavailable" };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULT_SETTINGS).then((settings) => {
    chrome.storage.sync.set(settings);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "TURN_COMPLETED") {
    handleCompletion(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "TEST_SOUND") {
    getSettings()
      .then((settings) =>
        playSound(Math.min(1, Math.max(0, Number(settings.volume) || 0))),
      )
      .then(() => sendResponse({ played: true }))
      .catch(() => sendResponse({ played: false }));
    return true;
  }

  return undefined;
});
