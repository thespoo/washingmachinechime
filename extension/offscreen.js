const audio = new Audio(
  chrome.runtime.getURL("assets/the-trout-chime.wav"),
);
audio.preload = "auto";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    !message ||
    message.target !== "offscreen" ||
    message.type !== "PLAY_SOUND"
  ) {
    return undefined;
  }

  audio.pause();
  audio.currentTime = 0;
  audio.volume = Math.min(1, Math.max(0, Number(message.volume) || 0));

  audio
    .play()
    .then(() => sendResponse({ played: true }))
    .catch(() => sendResponse({ played: false }));

  return true;
});
