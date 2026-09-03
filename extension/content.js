(function runContentScript() {
  "use strict";

  const detectorApi = globalThis.WashingMachineChimeDetector;
  if (!detectorApi) {
    return;
  }

  const PROVIDERS = {
    "chatgpt.com": {
      id: "chatgpt",
      assistantSelectors: [
        '[data-message-author-role="assistant"]',
        ".agent-turn",
        ".markdown.prose",
      ],
      busySelectors: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop generating" i]',
        'button[aria-label*="Stop streaming" i]',
      ],
      userSelectors: [
        '[data-message-author-role="user"]',
        '[data-testid="user-message"]',
      ],
    },
    "claude.ai": {
      id: "claude",
      assistantSelectors: [
        ".font-claude-response",
        '[data-is-streaming="true"]',
        '[data-testid="assistant-message"]',
      ],
      busySelectors: [
        'button[aria-label*="Stop" i]',
        'button[data-testid="stop-button"]',
      ],
      userSelectors: [
        '[data-testid="user-message"]',
        ".font-user-message",
        ".human-turn",
      ],
    },
  };

  const provider = PROVIDERS[location.hostname];
  if (!provider) {
    return;
  }

  function queryFirstPopulated(selectors) {
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 0) {
        return elements;
      }
    }
    return [];
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function collectionToken(elements) {
    if (elements.length === 0) {
      return "";
    }

    const recent = elements.slice(-2);
    const content = recent
      .map((element) => (element.textContent || "").trim())
      .join("\u241f");
    return `${elements.length}:${content.length}:${hashText(content)}`;
  }

  function selectorExists(selectors) {
    return selectors.some((selector) => document.querySelector(selector));
  }

  function snapshot() {
    const assistantElements = queryFirstPopulated(provider.assistantSelectors);
    const userElements = queryFirstPopulated(provider.userSelectors);
    const lastAssistant = assistantElements.at(-1);
    const assistantErrored = Boolean(
      lastAssistant &&
        (lastAssistant.matches(
          '[data-message-status="error"], [data-is-error="true"]',
        ) ||
          lastAssistant.querySelector(
            '[data-message-status="error"], [data-is-error="true"]',
          )),
    );

    return {
      assistantPresent: assistantElements.length > 0,
      assistantToken: collectionToken(assistantElements),
      busy: selectorExists(provider.busySelectors),
      error: assistantErrored,
      userToken: collectionToken(userElements),
    };
  }

  let currentUrl = location.href;
  let evaluationTimer = null;

  const detector = new detectorApi.TurnCompletionDetector({
    onComplete(completion) {
      const completionId = [
        provider.id,
        location.pathname,
        completion.turnId,
      ].join(":");

      chrome.runtime
        .sendMessage({
          type: "TURN_COMPLETED",
          completionId,
          provider: provider.id,
          pageVisible: document.visibilityState === "visible",
        })
        .catch(() => {
          // The extension may have reloaded while this page remained open.
        });
    },
  });

  function evaluate() {
    evaluationTimer = null;
    const nextSnapshot = snapshot();

    if (location.href !== currentUrl) {
      currentUrl = location.href;
      if (!detector.isPending()) {
        detector.reset(nextSnapshot);
        return;
      }
    }

    const result = detector.update(nextSnapshot);
    if (result.checkInMs !== null) {
      scheduleEvaluation(Math.max(50, result.checkInMs + 25));
    }
  }

  function scheduleEvaluation(delay = 120) {
    if (evaluationTimer !== null) {
      clearTimeout(evaluationTimer);
    }
    evaluationTimer = setTimeout(evaluate, delay);
  }

  detector.reset(snapshot());

  const observer = new MutationObserver(() => scheduleEvaluation());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "aria-label",
      "data-is-error",
      "data-is-streaming",
      "data-message-status",
      "data-testid",
      "disabled",
    ],
    characterData: true,
    childList: true,
    subtree: true,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "CHECK_PAGE_STATE") {
      sendResponse({
        pageVisible: document.visibilityState === "visible",
      });
    }
  });

  window.addEventListener("pageshow", () => {
    currentUrl = location.href;
    detector.reset(snapshot());
  });
})();
