import assert from "node:assert/strict";
import test from "node:test";

import { isCompletionEvent } from "../cli/wmchime.mjs";

test("accepts Claude Code and Codex Stop hooks", () => {
  assert.equal(
    isCompletionEvent({
      hook_event_name: "Stop",
      background_tasks: [],
      session_crons: [],
    }),
    true,
  );
  assert.equal(
    isCompletionEvent({
      hook_event_name: "Stop",
      model: "gpt-5.6",
    }),
    true,
  );
});

test("accepts the Codex external notifier payload", () => {
  assert.equal(
    isCompletionEvent({ type: "agent-turn-complete" }),
    true,
  );
});

test("skips responses that still have background or scheduled work", () => {
  assert.equal(
    isCompletionEvent({
      hook_event_name: "Stop",
      background_tasks: [{ id: "task-1" }],
      session_crons: [],
    }),
    false,
  );
  assert.equal(
    isCompletionEvent({
      hook_event_name: "Stop",
      background_tasks: [],
      session_crons: [{ id: "cron-1" }],
    }),
    false,
  );
});

test("rejects failures and unrelated hook events", () => {
  assert.equal(isCompletionEvent({ hook_event_name: "StopFailure" }), false);
  assert.equal(isCompletionEvent({ hook_event_name: "PostToolUse" }), false);
  assert.equal(isCompletionEvent(null), false);
});
