(function exposeRoutePolicy(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WashingMachineChimeRoutePolicy = api;
})(typeof globalThis === "object" ? globalThis : this, function createApi() {
  "use strict";

  const NEW_CHAT_TRANSITION_WINDOW_MS = 30_000;
  const USER_NAVIGATION_WINDOW_MS = 2_000;

  function conversationId(provider, pathname) {
    const path = String(pathname || "");
    const pattern =
      provider === "claude"
        ? /(?:^|\/)chat\/([^/?#]+)/
        : /(?:^|\/)c\/([^/?#]+)/;
    return pattern.exec(path)?.[1] || "";
  }

  function routeIdentity(provider, pathname) {
    const id = conversationId(provider, pathname);
    return id ? `${provider}:conversation:${id}` : `${provider}:path:${pathname}`;
  }

  function shouldPreserveRouteChange({
    fromPath,
    now,
    pending,
    provider,
    submissionAt,
    submissionUnobserved,
    submittedPromptPresent = false,
    targetContainsSubmittedPrompt = false,
    toPath,
    userNavigationAt = 0,
  }) {
    const fromConversation = conversationId(provider, fromPath);
    const toConversation = conversationId(provider, toPath);

    if (
      fromConversation &&
      toConversation &&
      fromConversation === toConversation
    ) {
      return true;
    }

    const recentSubmission =
      Number.isFinite(submissionAt) &&
      submissionAt > 0 &&
      now - submissionAt >= 0 &&
      now - submissionAt <= NEW_CHAT_TRANSITION_WINDOW_MS;
    const recentUserNavigation =
      Number.isFinite(userNavigationAt) &&
      userNavigationAt > 0 &&
      now - userNavigationAt >= 0 &&
      now - userNavigationAt <= USER_NAVIGATION_WINDOW_MS;

    if (
      recentUserNavigation ||
      (submittedPromptPresent && !targetContainsSubmittedPrompt)
    ) {
      return false;
    }

    return Boolean(
      !fromConversation &&
        toConversation &&
        recentSubmission &&
        (pending || submissionUnobserved),
    );
  }

  return {
    NEW_CHAT_TRANSITION_WINDOW_MS,
    USER_NAVIGATION_WINDOW_MS,
    conversationId,
    routeIdentity,
    shouldPreserveRouteChange,
  };
});
