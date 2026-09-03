#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

  const command = String(hook.command || "");
  const referencesExecutable =
    basename(command) === "wmchime.mjs" ||
    /(?:^|[/\\])wmchime\.mjs(?:["'\s]|$)/.test(command);
  const passesHookArgument =
    (Array.isArray(hook.args) && hook.args.includes("--hook")) ||
    /(?:^|\s)--hook(?:\s|$)/.test(command);

  return (
    referencesExecutable &&
    passesHookArgument
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function addWmChimeHook(
  config,
  executable,
  eventName = "Stop",
  commandStyle = "exec",
) {
  const updated = removeWmChimeHooks(config, eventName);
  updated.hooks ||= {};

  if (
    updated.hooks[eventName] !== undefined &&
    !Array.isArray(updated.hooks[eventName])
  ) {
    throw new Error(`hooks.${eventName} must be an array`);
  }

  updated.hooks[eventName] ||= [];
  const commandHook =
    commandStyle === "shell"
      ? {
          type: "command",
          command: `${shellQuote(resolve(executable))} --hook`,
          timeout: 10,
        }
      : {
          type: "command",
          command: resolve(executable),
          args: ["--hook"],
          timeout: 10,
        };

  updated.hooks[eventName].push({
    hooks: [commandHook],
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

function configLocation(path) {
  let fileInfo;
  try {
    fileInfo = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false, logicalPath: path, targetPath: path };
    }
    throw error;
  }

  if (!fileInfo.isSymbolicLink()) {
    return { exists: true, logicalPath: path, targetPath: path };
  }

  try {
    return {
      exists: true,
      logicalPath: path,
      targetPath: realpathSync(path),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Refusing to replace dangling config symlink: ${path}`);
    }
    throw error;
  }
}

function serialized(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function writeJsonAtomically(location, config, backup) {
  const { exists: existed, logicalPath, targetPath } = location;
  const next = serialized(config);
  const previous = existed ? readFileSync(targetPath, "utf8") : "";

  if (previous === next) {
    return false;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  if (backup && existed) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(
      targetPath,
      `${logicalPath}.wmchime-backup-${timestamp}`,
    );
  }

  const temporaryPath = `${targetPath}.wmchime-${process.pid}.tmp`;
  writeFileSync(temporaryPath, next, {
    mode: existed ? statSync(targetPath).mode & 0o777 : 0o600,
  });
  renameSync(temporaryPath, targetPath);
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
    {
      commandStyle: "exec",
      path: join(home, ".claude", "settings.json"),
    },
    {
      commandStyle: "shell",
      path: join(home, ".codex", "hooks.json"),
    },
  ];
  const plans = targets.map(({ commandStyle, path }) => {
    const location = configLocation(path);
    if (uninstall && !location.exists) {
      return { location, path, skip: true };
    }

    const current = readJson(location.targetPath);
    const next = uninstall
      ? removeWmChimeHooks(current)
      : addWmChimeHook(current, executable, "Stop", commandStyle);
    return { location, next, path, skip: false };
  });

  return plans.map(({ location, next, path, skip }) => {
    if (skip) {
      return { changed: false, path };
    }
    return {
      changed: writeJsonAtomically(location, next, backup),
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
