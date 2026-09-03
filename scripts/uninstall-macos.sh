#!/bin/bash

set -euo pipefail

INSTALL_ROOT="$HOME/Library/Application Support/LaundryDoneAIChime"
BIN_LINK="$HOME/.local/bin/wmchime"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$INSTALL_ROOT/configure-hooks.mjs" ]]; then
  node "$INSTALL_ROOT/configure-hooks.mjs" --uninstall
else
  node "$SCRIPT_DIR/configure-hooks.mjs" --uninstall
fi

if [[ -L "$BIN_LINK" ]] &&
  [[ "$(readlink "$BIN_LINK")" == "$INSTALL_ROOT/wmchime.mjs" ]]; then
  rm "$BIN_LINK"
fi

rm -rf "$INSTALL_ROOT"
echo "Uninstalled Laundry Done AI Chime."
