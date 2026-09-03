#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isWmChimeHook(hook) {
  if (!hook || hook.type !== "command") {
    return false;
  }

  const commandName = basename(String(hook.command || ""));
  return (
    commandName === "wmchime.mjs" &&
    Array.isArray(hook.args) &&
    hook.args.includes("--hook")
  );
}

export function removeWmChimeHooks(config, eventName = "Stop") {
  const updated = clone(config);
  const eventGroups = updated.hooks && updated.hooks[eventName];

  if (!Array.isArray(eventGroups)) {
    return updated;
  }

  updated.hooks[eventName] = eventGroups
    .map((group) => {
      if (!group || !Array.isArray(group.hooks)) {
        return group;
      }
      return {
        ...group,
        hooks: group.hooks.filter((hook) => !isWmChimeHook(hook)),
      };
    })
    .filter((group) => !group || !Array.isArray(group.hooks) || group.hooks.length);

  if (updated.hooks[eventName].length === 0) {
    delete updated.hooks[eventName];
  }
  if (Object.keys(updated.hooks).length === 0) {
    delete updated.hooks;
  }

  return updated;
}

export function addWmChimeHook(config, executable, eventName = "Stop") {
  const updated = removeWmChimeHooks(config, eventName);
  updated.hooks ||= {};

  if (
    updated.hooks[eventName] !== undefined &&
    !Array.isArray(updated.hooks[eventName])
  ) {
    throw new Error(`hooks.${eventName} must be an array`);
  }

  updated.hooks[eventName] ||= [];
  updated.hooks[eventName].push({
    hooks: [
      {
        type: "command",
        command: resolve(executable),
        args: ["--hook"],
        timeout: 10,
      },
    ],
  });

  return updated;
}

function readJson(path) {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${path}: ${error.message}`);
  }
}

function serialized(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeJsonAtomically(path, config, backup) {
  const next = serialized(config);
  const existed = existsSync(path);
  const previous = existed ? readFileSync(path, "utf8") : "";

  if (previous === next) {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  if (backup && existed) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(path, `${path}.wmchime-backup-${timestamp}`);
  }

  const temporaryPath = `${path}.wmchime-${process.pid}.tmp`;
  writeFileSync(temporaryPath, next, {
    mode: existed ? statSync(path).mode : 0o600,
  });
  renameSync(temporaryPath, path);
  return true;
}

export function configureHooks({
  backup = true,
  executable,
  home = homedir(),
  uninstall = false,
}) {
  if (!uninstall && !executable) {
    throw new Error("An executable path is required when installing hooks.");
  }

  const targets = [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "hooks.json"),
  ];
  const plans = targets.map((path) => {
    if (uninstall && !existsSync(path)) {
      return { path, skip: true };
    }

    const current = readJson(path);
    const next = uninstall
      ? removeWmChimeHooks(current)
      : addWmChimeHook(current, executable);
    return { next, path, skip: false };
  });

  return plans.map(({ next, path, skip }) => {
    if (skip) {
      return { changed: false, path };
    }
    return {
      changed: writeJsonAtomically(path, next, backup),
      path,
    };
  });
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function main() {
  const args = process.argv.slice(2);
  const uninstall = args.includes("--uninstall");
  const home = argumentValue(args, "--home") || homedir();
  const executable = argumentValue(args, "--executable");
  const results = configureHooks({ executable, home, uninstall });

  for (const result of results) {
    console.log(
      `${result.changed ? "Updated" : "Unchanged"} ${result.path}`,
    );
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
