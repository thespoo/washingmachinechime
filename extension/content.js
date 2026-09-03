(function runContentScript() {
  "use strict";

  const detectorApi = globalThis.WashingMachineChimeDetector;
  const routeApi = globalThis.WashingMachineChimeRoutePolicy;
  if (!detectorApi || !routeApi) {
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
  const STOP_BUTTON_SELECTOR = provider.busySelectors.join(",");

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

  function elementText(element) {
    if (!element) {
      return "";
    }
    if ("value" in element && typeof element.value === "string") {
      return element.value;
    }
    return element.textContent || "";
  }

  function promptFingerprint(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized
      ? `${normalized.length}:${hashText(normalized)}`
      : "";
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

  let cancellationSequence = 0;
  let lastSubmittedPromptFingerprint = "";
  let submissionSequence = 0;
  let lastSubmissionAt = 0;
  let lastUserNavigationAt = 0;
  let stopRequestedAt = 0;

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
      cancellationToken: String(cancellationSequence),
      error: assistantErrored,
      latestUserFingerprint: promptFingerprint(
        elementText(userElements.at(-1)),
      ),
      submissionToken: String(submissionSequence),
      userToken: collectionToken(userElements),
    };
  }

  let currentPath = location.pathname;
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
        })
        .catch(() => {
          // The extension may have reloaded while this page remained open.
        });
    },
  });

  function evaluate() {
    evaluationTimer = null;
    const now = Date.now();
    const nextSnapshot = snapshot();

    if (stopRequestedAt) {
      const stopRequestAge = now - stopRequestedAt;
      if (stopRequestAge > 2_000) {
        stopRequestedAt = 0;
      } else if (!nextSnapshot.busy) {
        cancellationSequence += 1;
        nextSnapshot.cancellationToken = String(cancellationSequence);
        stopRequestedAt = 0;
      }
    }

    const nextPath = location.pathname;
    if (nextPath !== currentPath) {
      const routeChanged =
        routeApi.routeIdentity(provider.id, nextPath) !==
        routeApi.routeIdentity(provider.id, currentPath);
      const submissionUnobserved =
        submissionSequence !== lastEvaluatedSubmissionSequence;
      const fromConversation = routeApi.conversationId(
        provider.id,
        currentPath,
      );
      const toConversation = routeApi.conversationId(
        provider.id,
        nextPath,
      );
      const recentSubmission =
        lastSubmissionAt > 0 &&
        now - lastSubmissionAt >= 0 &&
        now - lastSubmissionAt <=
          routeApi.NEW_CHAT_TRANSITION_WINDOW_MS;
      const recentUserNavigation =
        lastUserNavigationAt > 0 &&
        now - lastUserNavigationAt >= 0 &&
        now - lastUserNavigationAt <=
          routeApi.USER_NAVIGATION_WINDOW_MS;
      const promptMatches =
        !lastSubmittedPromptFingerprint ||
        nextSnapshot.latestUserFingerprint ===
          lastSubmittedPromptFingerprint;
      const awaitingSubmittedPrompt =
        routeChanged &&
        !fromConversation &&
        Boolean(toConversation) &&
        recentSubmission &&
        (detector.isPending() || submissionUnobserved) &&
        !recentUserNavigation &&
        !promptMatches &&
        now - lastSubmissionAt <= 5_000;

      if (awaitingSubmittedPrompt) {
        scheduleEvaluation(100);
        return;
      }

      const preservePendingTurn =
        routeChanged &&
        routeApi.shouldPreserveRouteChange({
          fromPath: currentPath,
          now,
          pending: detector.isPending(),
          provider: provider.id,
          submissionAt: lastSubmissionAt,
          submissionUnobserved,
          submittedPromptPresent: Boolean(
            lastSubmittedPromptFingerprint,
          ),
          targetContainsSubmittedPrompt: promptMatches,
          toPath: nextPath,
          userNavigationAt: lastUserNavigationAt,
        });

      currentPath = nextPath;
      if (routeChanged && !preservePendingTurn) {
        detector.reset(nextSnapshot);
        lastEvaluatedSubmissionSequence = submissionSequence;
        return;
      }
    }

    const result = detector.update(nextSnapshot);
    lastEvaluatedSubmissionSequence = submissionSequence;
    let nextCheck = result.checkInMs;
    if (stopRequestedAt && nextSnapshot.busy) {
      nextCheck =
        nextCheck === null ? 100 : Math.min(nextCheck, 100);
    }
    if (nextCheck !== null) {
      scheduleEvaluation(Math.max(50, nextCheck + 25));
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
    const composer = document.querySelector(COMPOSER_SELECTOR);
    lastSubmittedPromptFingerprint = promptFingerprint(
      elementText(composer),
    );
    lastSubmissionAt = now;
    submissionSequence += 1;
    scheduleEvaluation(0);
  }

  function requestCancellation() {
    stopRequestedAt = Date.now();
    scheduleEvaluation(50);
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
      const clickedElement =
        event.target instanceof Element ? event.target : null;
      const conversationLink = clickedElement?.closest("a[href]");
      if (conversationLink) {
        try {
          const destination = new URL(
            conversationLink.href,
            location.href,
          );
          if (
            destination.hostname === location.hostname &&
            routeApi.conversationId(
              provider.id,
              destination.pathname,
            ) &&
            routeApi.routeIdentity(
              provider.id,
              destination.pathname,
            ) !== routeApi.routeIdentity(provider.id, currentPath)
          ) {
            lastUserNavigationAt = Date.now();
          }
        } catch {
          // Ignore malformed or non-navigation link targets.
        }
      }

      const stopButton =
        clickedElement?.closest(STOP_BUTTON_SELECTOR);
      if (stopButton && !stopButton.disabled) {
        requestCancellation();
        return;
      }

      const button =
        clickedElement?.closest(SEND_BUTTON_SELECTOR);
      if (button && !button.disabled) {
        markSubmission();
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        selectorExists(provider.busySelectors)
      ) {
        requestCancellation();
        return;
      }

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

  window.addEventListener("popstate", () => {
    lastUserNavigationAt = Date.now();
  });

  window.addEventListener("pageshow", () => {
    currentPath = location.pathname;
    stopRequestedAt = 0;
    detector.reset(snapshot());
    lastEvaluatedSubmissionSequence = submissionSequence;
  });
})();
