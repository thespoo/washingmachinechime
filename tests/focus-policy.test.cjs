const assert = require("node:assert/strict");
const test = require("node:test");

const {
  shouldPlayForPage,
} = require("../extension/lib/focus-policy.js");

test("suppresses sound for the visible active tab in the focused window", () => {
  assert.equal(
    shouldPlayForPage({
      pageVisible: true,
      tabActive: true,
      windowFocused: true,
    }),
    false,
  );
});

test("plays for an inactive tab", () => {
  assert.equal(
    shouldPlayForPage({
      pageVisible: false,
      tabActive: false,
      windowFocused: true,
    }),
    true,
  );
});

test("plays when the browser window is in the background", () => {
  assert.equal(
    shouldPlayForPage({
      pageVisible: true,
      tabActive: true,
      windowFocused: false,
    }),
    true,
  );
});

test("fails closed when focus state is unavailable", () => {
  assert.equal(shouldPlayForPage({}), false);
  assert.equal(shouldPlayForPage(null), false);
});

test("uses current browser focus instead of stale page visibility", () => {
  assert.equal(
    shouldPlayForPage({
      pageVisible: false,
      tabActive: true,
      windowFocused: true,
    }),
    false,
  );
});
