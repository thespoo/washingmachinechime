(function exposeCompletionDetector(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WashingMachineChimeDetector = api;
})(typeof globalThis === "object" ? globalThis : this, function createApi() {
  "use strict";

  const DEFAULT_SETTLE_MS = 1800;

  function normalizeSnapshot(snapshot) {
    return {
      assistantPresent: Boolean(snapshot && snapshot.assistantPresent),
      assistantToken: String((snapshot && snapshot.assistantToken) || ""),
      busy: Boolean(snapshot && snapshot.busy),
      error: Boolean(snapshot && snapshot.error),
      submissionToken: String((snapshot && snapshot.submissionToken) || ""),
      userToken: String((snapshot && snapshot.userToken) || ""),
    };
  }

  class TurnCompletionDetector {
    constructor(options = {}) {
      this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
      this.onComplete =
        typeof options.onComplete === "function" ? options.onComplete : () => {};
      this.now =
        typeof options.now === "function" ? options.now : () => Date.now();
      this.sequence = 0;
      this.initialized = false;
      this.pending = false;
      this.previous = null;
      this.baselineAssistantToken = "";
      this.lastActivityAt = 0;
      this.sawAssistantChange = false;
      this.turnId = "";
    }

    reset(snapshot) {
      this.initialized = true;
      this.pending = false;
      this.previous = normalizeSnapshot(snapshot);
      this.baselineAssistantToken = this.previous.assistantToken;
      this.lastActivityAt = 0;
      this.sawAssistantChange = false;
      this.turnId = "";
    }

    isPending() {
      return this.pending;
    }

    startTurn(previous, at) {
      this.sequence += 1;
      this.pending = true;
      this.baselineAssistantToken = previous.assistantToken;
      this.lastActivityAt = at;
      this.sawAssistantChange = false;
      this.turnId = `${at}-${this.sequence}`;
    }

    update(rawSnapshot, at = this.now()) {
      const snapshot = normalizeSnapshot(rawSnapshot);

      if (!this.initialized) {
        this.reset(snapshot);
        return { completed: false, checkInMs: null };
      }

      const previous = this.previous;
      const submissionChanged =
        snapshot.submissionToken !== previous.submissionToken;
      const busyStarted = snapshot.busy && !previous.busy;

      if (
        (!this.pending && (submissionChanged || busyStarted)) ||
        (this.pending && submissionChanged)
      ) {
        this.startTurn(previous, at);
      }

      let completed = false;
      let checkInMs = null;

      if (this.pending) {
        const assistantChanged =
          Boolean(snapshot.assistantToken) &&
          snapshot.assistantToken !== this.baselineAssistantToken;

        if (assistantChanged) {
          this.sawAssistantChange = true;
        }

        if (
          snapshot.busy ||
          snapshot.assistantToken !== previous.assistantToken
        ) {
          this.lastActivityAt = at;
        }

        if (snapshot.error) {
          this.pending = false;
        } else if (
          this.sawAssistantChange &&
          snapshot.assistantPresent &&
          !snapshot.busy
        ) {
          const remaining = this.settleMs - (at - this.lastActivityAt);

          if (remaining <= 0) {
            const completion = {
              completedAt: at,
              turnId: this.turnId,
            };
            this.pending = false;
            completed = true;
            this.onComplete(completion);
          } else {
            checkInMs = remaining;
          }
        }
      }

      this.previous = snapshot;
      return { completed, checkInMs };
    }
  }

  return {
    DEFAULT_SETTLE_MS,
    TurnCompletionDetector,
    normalizeSnapshot,
  };
});
