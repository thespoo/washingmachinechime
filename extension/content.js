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

  const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
  ].join(",");
  const SEND_BUTTON_SELECTOR = [
    'button[data-testid="send-button"]',
    'button[aria-label="Send message" i]',
    'button[aria-label="Send prompt" i]',
  ].join(",");

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

  let submissionSequence = 0;
  let lastSubmissionAt = 0;

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
      submissionToken: String(submissionSequence),
      userToken: collectionToken(userElements),
    };
  }

  let currentUrl = location.href;
  let evaluationTimer = null;
  let lastEvaluatedSubmissionSequence = submissionSequence;

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
      if (
        !detector.isPending() &&
        submissionSequence === lastEvaluatedSubmissionSequence
      ) {
        detector.reset(nextSnapshot);
        lastEvaluatedSubmissionSequence = submissionSequence;
        return;
      }
    }

    const result = detector.update(nextSnapshot);
    lastEvaluatedSubmissionSequence = submissionSequence;
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

  function markSubmission() {
    const now = Date.now();
    if (now - lastSubmissionAt < 250) {
      return;
    }
    lastSubmissionAt = now;
    submissionSequence += 1;
    scheduleEvaluation(0);
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.querySelector(COMPOSER_SELECTOR)
      ) {
        markSubmission();
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest(SEND_BUTTON_SELECTOR)
          : null;
      if (button && !button.disabled) {
        markSubmission();
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const inComposer =
        event.target instanceof Element &&
        event.target.closest(COMPOSER_SELECTOR);
      if (
        inComposer &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        markSubmission();
      }
    },
    true,
  );

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
