import { spawnSync } from "node:child_process";

const TERMINAL_BUNDLES = new Set([
  "co.zeit.hyper",
  "com.apple.Terminal",
  "com.cmuxterm.app",
  "com.github.wez.wezterm",
  "com.googlecode.iterm2",
  "com.mitchellh.ghostty",
  "com.raphaelamorim.rio",
  "net.kovidgoyal.kitty",
  "org.alacritty",
  "org.tabby",
]);

const TERM_PROGRAM_BUNDLES = new Map([
  ["alacritty", ["org.alacritty"]],
  ["apple_terminal", ["com.apple.Terminal"]],
  ["ghostty", ["com.mitchellh.ghostty"]],
  ["hyper", ["co.zeit.hyper"]],
  ["iterm", ["com.googlecode.iterm2"]],
  ["iterm2", ["com.googlecode.iterm2"]],
  ["kitty", ["net.kovidgoyal.kitty"]],
  ["rio", ["com.raphaelamorim.rio"]],
  ["tabby", ["org.tabby"]],
  ["warp", ["dev.warp.Warp-Stable", "dev.warp.Warp-Preview"]],
  ["warpterminal", ["dev.warp.Warp-Stable", "dev.warp.Warp-Preview"]],
  ["wezterm", ["com.github.wez.wezterm"]],
]);

function run(command, args, timeout = 2500) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout,
  });

  if (result.status !== 0 || result.error) {
    return "";
  }
  return result.stdout.trim();
}

export function normalizeTty(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "??" || normalized === "-") {
    return "";
  }
  return normalized.replace(/^\/dev\//, "");
}

export function terminalBundleCandidates(env = process.env) {
  const candidates = new Set();
  const inheritedBundle = String(env.__CFBundleIdentifier || "").trim();
  if (inheritedBundle) {
    return [inheritedBundle];
  }

  const termProgram = String(env.TERM_PROGRAM || "")
    .replace(/\.app$/i, "")
    .toLowerCase();

  if (termProgram === "vscode") {
    const editorEvidence = [
      env.VSCODE_GIT_ASKPASS_NODE,
      env.VSCODE_IPC_HOOK_CLI,
      env.VSCODE_NLS_CONFIG,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (editorEvidence.includes("cursor")) {
      candidates.add("com.todesktop.230313mzl4w4u92");
      candidates.add("com.cursor.Cursor");
    } else if (editorEvidence.includes("visual studio code - insiders")) {
      candidates.add("com.microsoft.VSCodeInsiders");
    } else if (editorEvidence.includes("visual studio code")) {
      candidates.add("com.microsoft.VSCode");
    }
  } else {
    for (const bundle of TERM_PROGRAM_BUNDLES.get(termProgram) || []) {
      candidates.add(bundle);
    }
  }

  return [...candidates];
}

export function bundleMatches(actual, expected) {
  if (!actual || !expected) {
    return false;
  }
  if (expected.startsWith("dev.warp.Warp")) {
    return actual.startsWith("dev.warp.Warp");
  }
  return actual === expected;
}

export function isTerminalBundle(bundleId) {
  return (
    TERMINAL_BUNDLES.has(bundleId) ||
    String(bundleId || "").startsWith("dev.warp.Warp")
  );
}

export function parseProcessTable(output) {
  const processes = new Map();
  for (const line of String(output || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/);
    if (!match) {
      continue;
    }
    processes.set(Number(match[1]), {
      parentPid: Number(match[2]),
      tty: normalizeTty(match[3]),
    });
  }
  return processes;
}

export function findAncestorTty(startingPid = process.ppid, processTable) {
  const table =
    processTable ||
    parseProcessTable(run("/bin/ps", ["-axo", "pid=,ppid=,tty="]));
  const visited = new Set();
  let pid = startingPid;

  while (pid > 0 && !visited.has(pid)) {
    visited.add(pid);
    const processInfo = table.get(pid);
    if (!processInfo) {
      break;
    }
    if (processInfo.tty) {
      return processInfo.tty;
    }
    pid = processInfo.parentPid;
  }

  return "";
}

export function getFrontmostBundleId() {
  const script = [
    'ObjC.import("AppKit");',
    "const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;",
    'app ? ObjC.unwrap(app.bundleIdentifier) : "";',
  ].join(" ");
  return run("/usr/bin/osascript", ["-l", "JavaScript", "-e", script]);
}

export function getSelectedTerminalTty(bundleId) {
  let script = "";

  if (bundleId === "com.apple.Terminal") {
    script = [
      'tell application "Terminal"',
      'if not (exists window 1) then return ""',
      "return tty of selected tab of window 1",
      "end tell",
    ].join("\n");
  } else if (bundleId === "com.googlecode.iterm2") {
    script = [
      'tell application "iTerm2"',
      'if not (exists current window) then return ""',
      "return tty of current session of current window",
      "end tell",
    ].join("\n");
  }

  return script
    ? normalizeTty(run("/usr/bin/osascript", ["-e", script]))
    : "";
}

export function evaluateMacFocus({
  frontmostBundleId,
  multiplexer = false,
  originTty,
  selectedTty,
  sourceBundles,
}) {
  if (multiplexer) {
    return { shouldPlay: false, reason: "terminal-multiplexer-unresolved" };
  }

  if (!frontmostBundleId || !Array.isArray(sourceBundles)) {
    return { shouldPlay: false, reason: "focus-unknown" };
  }

  if (sourceBundles.length === 0) {
    return { shouldPlay: false, reason: "source-terminal-unknown" };
  }

  const sourceIsFrontmost = sourceBundles.some((bundle) =>
    bundleMatches(frontmostBundleId, bundle),
  );

  if (!sourceIsFrontmost) {
    return { shouldPlay: true, reason: "terminal-not-frontmost" };
  }

  const normalizedOrigin = normalizeTty(originTty);
  const normalizedSelected = normalizeTty(selectedTty);
  if (
    normalizedOrigin &&
    normalizedSelected &&
    normalizedOrigin !== normalizedSelected
  ) {
    return { shouldPlay: true, reason: "terminal-tab-not-selected" };
  }

  return { shouldPlay: false, reason: "terminal-active" };
}

export function inspectMacFocus(env = process.env) {
  const sourceBundles = terminalBundleCandidates(env);
  const frontmostBundleId = getFrontmostBundleId();
  const originTty = findAncestorTty();
  const selectedTty = getSelectedTerminalTty(frontmostBundleId);
  const multiplexer = Boolean(env.TMUX || env.STY);
  const decision = evaluateMacFocus({
    frontmostBundleId,
    multiplexer,
    originTty,
    selectedTty,
    sourceBundles,
  });

  return {
    ...decision,
    frontmostBundleId,
    multiplexer,
    originTty,
    selectedTty,
    sourceBundles,
  };
}
