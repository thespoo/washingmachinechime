const assert = require("node:assert/strict");
const test = require("node:test");

const {
  conversationId,
  routeIdentity,
  shouldPreserveRouteChange,
} = require("../extension/lib/route-policy.js");

test("extracts provider conversation IDs from standard and project routes", () => {
  assert.equal(conversationId("chatgpt", "/c/chat-123"), "chat-123");
  assert.equal(
    conversationId("chatgpt", "/g/custom-gpt/c/chat-456"),
    "chat-456",
  );
  assert.equal(
    conversationId("claude", "/project/project-1/chat/chat-789"),
    "chat-789",
  );
  assert.equal(routeIdentity("claude", "/new"), "claude:path:/new");
});

test("preserves the expected route assignment for a submitted new chat", () => {
  assert.equal(
    shouldPreserveRouteChange({
      fromPath: "/",
      now: 2_000,
      pending: false,
      provider: "chatgpt",
      submissionAt: 1_000,
      submissionUnobserved: true,
      toPath: "/c/new-chat",
    }),
    true,
  );
});

test("does not carry a pending turn into another existing conversation", () => {
  assert.equal(
    shouldPreserveRouteChange({
      fromPath: "/c/chat-a",
      now: 2_000,
      pending: true,
      provider: "chatgpt",
      submissionAt: 1_000,
      submissionUnobserved: false,
      toPath: "/c/chat-b",
    }),
    false,
  );
});

test("does not treat normal history navigation as new-chat assignment", () => {
  assert.equal(
    shouldPreserveRouteChange({
      fromPath: "/",
      now: 2_000,
      pending: false,
      provider: "chatgpt",
      submissionAt: 0,
      submissionUnobserved: false,
      toPath: "/c/historical-chat",
    }),
    false,
  );
});

test("expires the new-chat route allowance", () => {
  assert.equal(
    shouldPreserveRouteChange({
      fromPath: "/new",
      now: 40_001,
      pending: true,
      provider: "claude",
      submissionAt: 1_000,
      submissionUnobserved: false,
      toPath: "/chat/new-chat",
    }),
    false,
  );
});
