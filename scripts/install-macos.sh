#!/bin/bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer supports macOS only." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_ROOT="$HOME/Library/Application Support/LaundryDoneAIChime"
BIN_DIR="$HOME/.local/bin"

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"

cp "$PROJECT_DIR/cli/wmchime.mjs" "$INSTALL_ROOT/wmchime.mjs"
cp "$PROJECT_DIR/cli/macos-focus.mjs" "$INSTALL_ROOT/macos-focus.mjs"
cp "$PROJECT_DIR/extension/assets/the-trout-chime.wav" \
  "$INSTALL_ROOT/the-trout-chime.wav"
cp "$PROJECT_DIR/scripts/configure-hooks.mjs" \
  "$INSTALL_ROOT/configure-hooks.mjs"

chmod 755 "$INSTALL_ROOT/wmchime.mjs"
ln -sfn "$INSTALL_ROOT/wmchime.mjs" "$BIN_DIR/wmchime"

node "$INSTALL_ROOT/configure-hooks.mjs" \
  --executable "$INSTALL_ROOT/wmchime.mjs"

cat <<EOF

Installed Laundry Done AI Chime.

Claude Code and Codex CLI will now play the melody after a completed turn
when their terminal app is not active. Terminal.app and iTerm2 also detect
when the originating tab is not selected.

Test sound:
  "$BIN_DIR/wmchime" --test

Check focus detection:
  "$BIN_DIR/wmchime" --diagnose

If macOS asks whether osascript may control Terminal or iTerm2, allow it to
enable exact tab detection. App-level focus detection works without it.
EOF
