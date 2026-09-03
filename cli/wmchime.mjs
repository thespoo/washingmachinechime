#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectMacFocus } from "./macos-focus.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export function isCompletionEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (payload.type === "agent-turn-complete") {
    return true;
  }

  if (payload.hook_event_name !== "Stop") {
    return false;
  }

  const backgroundTasks = Array.isArray(payload.background_tasks)
    ? payload.background_tasks
    : [];
  const scheduledTasks = Array.isArray(payload.session_crons)
    ? payload.session_crons
    : [];

  return backgroundTasks.length === 0 && scheduledTasks.length === 0;
}

export function findAudioFile() {
  const candidates = [
    process.env.WMCHIME_AUDIO,
    resolve(scriptDirectory, "the-trout-chime.wav"),
    resolve(scriptDirectory, "../extension/assets/the-trout-chime.wav"),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

export function playChime(audioFile = findAudioFile()) {
  if (!audioFile || process.platform !== "darwin") {
    return false;
  }

  const player = spawn("/usr/bin/afplay", [audioFile], {
    detached: true,
    stdio: "ignore",
  });
  player.on("error", () => {});
  player.unref();
  return true;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input.trim();
}

export async function readPayload(args = process.argv.slice(2)) {
  const possibleJson = [...args]
    .reverse()
    .find((argument) => argument.trim().startsWith("{"));
  const raw = possibleJson || (await readStdin());

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--test")) {
    if (!findAudioFile()) {
      console.error("The chime audio file is missing.");
      return 1;
    }
    if (!playChime()) {
      console.error("Audio playback requires macOS and /usr/bin/afplay.");
      return 1;
    }
    console.log("Playing the test melody.");
    return 0;
  }

  if (args.includes("--diagnose")) {
    if (process.platform !== "darwin") {
      console.error("Focus diagnostics require macOS.");
      return 1;
    }
    console.log(JSON.stringify(inspectMacFocus(), null, 2));
    return 0;
  }

  const payload = await readPayload(args);
  if (!isCompletionEvent(payload) || process.platform !== "darwin") {
    return 0;
  }

  const focus = inspectMacFocus();
  if (focus.shouldPlay) {
    playChime();
  }
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
