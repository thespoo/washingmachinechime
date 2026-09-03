import assert from "node:assert/strict";
import test from "node:test";

import {
  bundleMatches,
  evaluateMacFocus,
  findAncestorTty,
  normalizeTty,
  parseProcessTable,
  terminalBundleCandidates,
} from "../cli/macos-focus.mjs";

test("normalizes macOS tty values", () => {
  assert.equal(normalizeTty("/dev/ttys004"), "ttys004");
  assert.equal(normalizeTty("ttys004"), "ttys004");
  assert.equal(normalizeTty("??"), "");
});

test("finds the first controlling tty in the parent chain", () => {
  const table = parseProcessTable(`
    100  50 ??
     50  10 ??
     10   1 ttys007
      1   0 ??
  `);

  assert.equal(findAncestorTty(100, table), "ttys007");
});

test("maps Terminal, iTerm, and Cursor environments to bundle IDs", () => {
  assert.deepEqual(
    terminalBundleCandidates({ TERM_PROGRAM: "Apple_Terminal" }),
    ["com.apple.Terminal"],
  );
  assert.deepEqual(
    terminalBundleCandidates({ TERM_PROGRAM: "iTerm.app" }),
    ["com.googlecode.iterm2"],
  );
  assert.ok(
    terminalBundleCandidates({ TERM_PROGRAM: "vscode" }).includes(
      "com.todesktop.230313mzl4w4u92",
    ),
  );
  assert.deepEqual(
    terminalBundleCandidates({
      __CFBundleIdentifier: "com.todesktop.230313mzl4w4u92",
      TERM_PROGRAM: "vscode",
    }),
    ["com.todesktop.230313mzl4w4u92"],
  );
});

test("detects when the originating terminal app is in the background", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.apple.Safari",
      originTty: "ttys001",
      selectedTty: "",
      sourceBundles: ["com.apple.Terminal"],
    }),
    { shouldPlay: true, reason: "terminal-not-frontmost" },
  );
});

test("detects another selected Terminal tab by tty", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.apple.Terminal",
      originTty: "ttys001",
      selectedTty: "/dev/ttys002",
      sourceBundles: ["com.apple.Terminal"],
    }),
    { shouldPlay: true, reason: "terminal-tab-not-selected" },
  );
});

test("suppresses sound in the originating active Terminal tab", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.apple.Terminal",
      originTty: "ttys001",
      selectedTty: "/dev/ttys001",
      sourceBundles: ["com.apple.Terminal"],
    }),
    { shouldPlay: false, reason: "terminal-active" },
  );
});

test("fails closed when the source terminal cannot be identified", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.apple.Safari",
      originTty: "ttys001",
      selectedTty: "",
      sourceBundles: [],
    }),
    { shouldPlay: false, reason: "source-terminal-unknown" },
  );
});

test("matches all Warp release-channel bundle IDs", () => {
  assert.equal(
    bundleMatches("dev.warp.Warp-Preview", "dev.warp.Warp-Stable"),
    true,
  );
});

test("fails closed on mismatched pane tty inside a frontmost multiplexer", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.googlecode.iterm2",
      multiplexer: true,
      originTty: "ttys-pane",
      selectedTty: "ttys-host",
      sourceBundles: ["com.googlecode.iterm2"],
    }),
    { shouldPlay: false, reason: "terminal-multiplexer-active" },
  );
});

test("still plays for a background terminal when using a multiplexer", () => {
  assert.deepEqual(
    evaluateMacFocus({
      frontmostBundleId: "com.apple.Safari",
      multiplexer: true,
      originTty: "ttys-pane",
      selectedTty: "",
      sourceBundles: ["com.googlecode.iterm2"],
    }),
    { shouldPlay: true, reason: "terminal-not-frontmost" },
  );
});
