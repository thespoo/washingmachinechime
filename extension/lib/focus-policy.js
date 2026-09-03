(function exposeFocusPolicy(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.WashingMachineChimeFocusPolicy = api;
})(typeof globalThis === "object" ? globalThis : this, function createApi() {
  "use strict";

  function shouldPlayForPage(state) {
    if (!state || typeof state !== "object") {
      return false;
    }

    if (state.tabActive === false || state.windowFocused === false) {
      return true;
    }

    return false;
  }

  return { shouldPlayForPage };
});
