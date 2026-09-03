#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules"]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exitCode = 1;
  }
}

const files = walk(projectRoot);
for (const file of files) {
  if ([".js", ".mjs", ".cjs"].includes(extname(file))) {
    run(process.execPath, ["--check", file]);
  }
  if (file.endsWith(".sh")) {
    run("/bin/bash", ["-n", file]);
  }
}

const manifestPath = resolve(projectRoot, "extension/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const extensionRoot = dirname(manifestPath);
const referencedFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((entry) => entry.js),
  "offscreen.html",
  "offscreen.js",
  "popup.css",
  "popup.js",
  "assets/the-trout-chime.wav",
];

for (const relativePath of referencedFiles) {
  if (!existsSync(resolve(extensionRoot, relativePath))) {
    console.error(`Missing extension file: ${relativePath}`);
    process.exitCode = 1;
  }
}

const wav = readFileSync(
  resolve(extensionRoot, "assets/the-trout-chime.wav"),
);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  console.error("The generated chime is not a valid WAV file.");
  process.exitCode = 1;
}

if (!process.exitCode) {
  console.log(`Checked ${files.length} project files.`);
}
