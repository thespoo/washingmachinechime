const enabledInput = document.querySelector("#enabled");
const volumeInput = document.querySelector("#volume");
const volumeValue = document.querySelector("#volume-value");
const testButton = document.querySelector("#test-sound");
const status = document.querySelector("#status");

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    enabled: true,
    volume: 0.7,
  });
  enabledInput.checked = settings.enabled;
  volumeInput.value = String(Math.round(settings.volume * 100));
  volumeValue.value = `${volumeInput.value}%`;
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledInput.checked });
  status.textContent = enabledInput.checked
    ? "Chime enabled"
    : "Chime paused";
});

volumeInput.addEventListener("input", () => {
  volumeValue.value = `${volumeInput.value}%`;
});

volumeInput.addEventListener("change", async () => {
  await chrome.storage.sync.set({
    volume: Number(volumeInput.value) / 100,
  });
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  status.textContent = "Starting melody…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "TEST_SOUND",
    });
    status.textContent = response && response.played
      ? "Melody playing"
      : "Could not play the melody";
  } catch {
    status.textContent = "Reload the extension and try again";
  } finally {
    testButton.disabled = false;
  }
});

loadSettings().catch(() => {
  status.textContent = "Could not load settings";
});
