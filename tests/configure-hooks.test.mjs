import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  configureHooks,
  isWmChimeHook,
} from "../scripts/configure-hooks.mjs";

function temporaryHome(t) {
  const home = mkdtempSync(join(tmpdir(), "wmchime-test-"));
  t.after(() => rmSync(home, { force: true, recursive: true }));
  return home;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("installs hooks without replacing existing hook groups", (t) => {
  const home = temporaryHome(t);
  const executable = join(
    home,
    "Library",
    "Application Support",
    "LaundryDoneAIChime",
    "wmchime.mjs",
  );
  const claudeDirectory = join(home, ".claude");
  mkdirSync(claudeDirectory, { recursive: true });
  writeFileSync(
    join(claudeDirectory, "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "existing",
            hooks: [{ type: "command", command: "/tmp/existing" }],
          },
        ],
      },
      theme: "dark",
    }),
  );

  const first = configureHooks({
    backup: false,
    executable,
    home,
  });
  const second = configureHooks({
    backup: false,
    executable,
    home,
  });

  const claude = readJson(join(home, ".claude", "settings.json"));
  const codex = readJson(join(home, ".codex", "hooks.json"));
  assert.equal(claude.theme, "dark");
  assert.equal(claude.hooks.Stop.length, 2);
  assert.equal(claude.hooks.Stop[0].hooks[0].command, "/tmp/existing");
  assert.equal(isWmChimeHook(claude.hooks.Stop[1].hooks[0]), true);
  assert.equal(isWmChimeHook(codex.hooks.Stop[0].hooks[0]), true);
  assert.deepEqual(claude.hooks.Stop[1].hooks[0].args, ["--hook"]);
  assert.equal(codex.hooks.Stop[0].hooks[0].args, undefined);
  assert.equal(codex.hooks.Stop[0].hooks[0].command, `'${executable}' --hook`);
  assert.deepEqual(first.map((result) => result.changed), [true, true]);
  assert.deepEqual(second.map((result) => result.changed), [false, false]);
});

test("uninstall removes only this project's hook", (t) => {
  const home = temporaryHome(t);
  configureHooks({
    backup: false,
    executable: join(home, "wmchime.mjs"),
    home,
  });

  const claudePath = join(home, ".claude", "settings.json");
  const claude = readJson(claudePath);
  claude.hooks.Stop.unshift({
    hooks: [{ type: "command", command: "/tmp/keep-me" }],
  });
  writeFileSync(claudePath, `${JSON.stringify(claude, null, 2)}\n`);

  configureHooks({ backup: false, home, uninstall: true });

  const updatedClaude = readJson(claudePath);
  const updatedCodex = readJson(join(home, ".codex", "hooks.json"));
  assert.equal(updatedClaude.hooks.Stop.length, 1);
  assert.equal(updatedClaude.hooks.Stop[0].hooks[0].command, "/tmp/keep-me");
  assert.deepEqual(updatedCodex, {});
});

test("invalid existing JSON prevents either config from changing", (t) => {
  const home = temporaryHome(t);
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  const claudePath = join(home, ".claude", "settings.json");
  const codexPath = join(home, ".codex", "hooks.json");
  writeFileSync(claudePath, '{"theme":"dark"}\n');
  writeFileSync(codexPath, "{not-json");

  assert.throws(
    () =>
      configureHooks({
        backup: false,
        executable: join(home, "wmchime.mjs"),
        home,
      }),
    /Cannot parse/,
  );
  assert.equal(readFileSync(claudePath, "utf8"), '{"theme":"dark"}\n');
});
