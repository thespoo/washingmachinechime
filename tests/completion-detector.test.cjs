const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TurnCompletionDetector,
} = require("../extension/lib/completion-detector.js");

function state(overrides = {}) {
  return {
    assistantPresent: true,
    assistantToken: "1:old",
    busy: false,
    cancellationToken: "0",
    error: false,
    submissionToken: "0",
    userToken: "1:first",
    ...overrides,
  };
}

test("ignores existing conversation content on initial load", () => {
  const completions = [];
  const detector = new TurnCompletionDetector({
    onComplete: (completion) => completions.push(completion),
    settleMs: 100,
  });

  detector.update(state(), 0);
  detector.update(state(), 1_000);

  assert.deepEqual(completions, []);
  assert.equal(detector.isPending(), false);
});

test("reports a streamed assistant response after it settles", () => {
  const completions = [];
  const detector = new TurnCompletionDetector({
    onComplete: (completion) => completions.push(completion),
    settleMs: 100,
  });

  detector.reset(state());
  detector.update(
    state({ submissionToken: "1", userToken: "2:second" }),
    10,
  );
  detector.update(
    state({
      assistantToken: "2:partial",
      busy: true,
      submissionToken: "1",
      userToken: "2:second",
    }),
    20,
  );
  detector.update(
    state({
      assistantToken: "2:final",
      submissionToken: "1",
      userToken: "2:second",
    }),
    40,
  );

  const waiting = detector.update(
    state({
      assistantToken: "2:final",
      submissionToken: "1",
      userToken: "2:second",
    }),
    139,
  );
  const finished = detector.update(
    state({
      assistantToken: "2:final",
      submissionToken: "1",
      userToken: "2:second",
    }),
    140,
  );

  assert.equal(waiting.completed, false);
  assert.equal(waiting.checkInMs, 1);
  assert.equal(finished.completed, true);
  assert.equal(completions.length, 1);
});

test("does not complete while the provider remains busy", () => {
  const detector = new TurnCompletionDetector({ settleMs: 50 });

  detector.reset(state());
  detector.update(state({ busy: true }), 10);
  const result = detector.update(
    state({ assistantToken: "2:streaming", busy: true }),
    1_000,
  );

  assert.equal(result.completed, false);
  assert.equal(detector.isPending(), true);
});

test("cancels a pending turn when its assistant response errors", () => {
  let completionCount = 0;
  const detector = new TurnCompletionDetector({
    onComplete: () => {
      completionCount += 1;
    },
    settleMs: 10,
  });

  detector.reset(state());
  detector.update(
    state({ submissionToken: "1", userToken: "2:second" }),
    1,
  );
  detector.update(
    state({
      assistantToken: "2:partial",
      busy: true,
      submissionToken: "1",
      userToken: "2:second",
    }),
    2,
  );
  detector.update(
    state({
      assistantToken: "2:error",
      error: true,
      submissionToken: "1",
      userToken: "2:second",
    }),
    3,
  );
  detector.update(
    state({
      assistantToken: "2:error",
      submissionToken: "1",
      userToken: "2:second",
    }),
    100,
  );

  assert.equal(completionCount, 0);
  assert.equal(detector.isPending(), false);
});

test("a new user turn supersedes a response still settling", () => {
  const completions = [];
  const detector = new TurnCompletionDetector({
    onComplete: (completion) => completions.push(completion),
    settleMs: 100,
  });

  detector.reset(state());
  detector.update(
    state({ submissionToken: "1", userToken: "2:second" }),
    5,
  );
  detector.update(
    state({
      assistantToken: "2:done",
      submissionToken: "1",
      userToken: "2:second",
    }),
    10,
  );
  detector.update(
    state({
      assistantToken: "2:done",
      submissionToken: "2",
      userToken: "3:third",
    }),
    20,
  );
  detector.update(
    state({
      assistantToken: "3:new-done",
      submissionToken: "2",
      userToken: "3:third",
    }),
    30,
  );
  detector.update(
    state({
      assistantToken: "3:new-done",
      submissionToken: "2",
      userToken: "3:third",
    }),
    130,
  );

  assert.equal(completions.length, 1);
});

test("ignores conversation history that hydrates after initialization", () => {
  const completions = [];
  const detector = new TurnCompletionDetector({
    onComplete: (completion) => completions.push(completion),
    settleMs: 10,
  });

  detector.reset(
    state({
      assistantPresent: false,
      assistantToken: "",
      userToken: "",
    }),
  );
  detector.update(
    state({
      assistantToken: "1:historical",
      userToken: "1:historical-user",
    }),
    5,
  );
  detector.update(
    state({
      assistantToken: "2:more-history",
      userToken: "2:more-history",
    }),
    100,
  );

  assert.equal(detector.isPending(), false);
  assert.deepEqual(completions, []);
});

test("a manual stop cancels the pending response", () => {
  const completions = [];
  const detector = new TurnCompletionDetector({
    onComplete: (completion) => completions.push(completion),
    settleMs: 10,
  });

  detector.reset(state());
  detector.update(
    state({
      assistantToken: "2:partial",
      busy: true,
      submissionToken: "1",
      userToken: "2:second",
    }),
    5,
  );
  detector.update(
    state({
      assistantToken: "2:partial",
      busy: false,
      cancellationToken: "1",
      submissionToken: "1",
      userToken: "2:second",
    }),
    6,
  );
  detector.update(
    state({
      assistantToken: "2:partial",
      cancellationToken: "1",
      submissionToken: "1",
      userToken: "2:second",
    }),
    100,
  );

  assert.equal(detector.isPending(), false);
  assert.deepEqual(completions, []);
});
