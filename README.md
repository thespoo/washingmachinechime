# Laundry Done: AI Chime

Plays a cheerful washing-machine finish melody when Claude or ChatGPT
completes a response while you are looking elsewhere.

The project has two integrations:

- A Chrome/Edge extension for `claude.ai` and `chatgpt.com`
- macOS completion hooks for Claude Code and OpenAI Codex CLI

The melody is this project's own synthesized arrangement of Franz Schubert's
public-domain *Die Forelle* (*The Trout*), the tune associated with Samsung
washer completion chimes. No Samsung recording is bundled.

## Browser extension

1. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this repository's `extension` folder.
4. Refresh any already-open Claude or ChatGPT tabs.
5. Open the extension popup and use **Play test melody**.

The extension starts tracking only after a new prompt is submitted. It ignores
old responses when a conversation is opened or reloaded. When a response
finishes, it checks both the selected tab and browser-window focus:

- Active chat tab in the foreground browser window: no sound
- Different tab, different window, or browser in the background: play sound

The provider sites do not publish a completion API, so the extension uses a
small, provider-specific DOM state machine. Selectors are isolated in
[`extension/content.js`](extension/content.js) so site changes can be updated
without touching playback or focus logic.

## macOS CLI setup

Requirements:

- macOS
- Node.js 18 or newer
- Claude Code and/or OpenAI Codex CLI

Install:

```bash
./scripts/install-macos.sh
```

The installer copies the notifier to
`~/Library/Application Support/LaundryDoneAIChime`, adds a `wmchime` command
under `~/.local/bin`, and safely appends a `Stop` hook to:

- `~/.claude/settings.json`
- `~/.codex/hooks.json`

Existing hooks and settings are preserved. Changed config files receive a
timestamped backup, and symlink-managed config files keep their symlinks.

Codex requires newly discovered hooks to be reviewed before they run. After
installing, start interactive Codex, run `/hooks`, review the new user-level
`Stop` hook, and mark it trusted. Codex skips the hook—including during
`codex exec`—until this one-time step is complete. The installer deliberately
does not bypass Codex's trust review.

Test the sound and inspect focus detection:

```bash
~/.local/bin/wmchime --test
~/.local/bin/wmchime --diagnose
```

Terminal.app and iTerm2 support exact tab detection by matching the hook's
controlling TTY to the selected tab. macOS may request one-time permission for
`osascript` to inspect the selected tab. Other terminals, including integrated
terminals in Cursor and VS Code, use app-level focus: the melody plays when
that app is in the background and stays quiet while the app is frontmost.

Inside tmux or screen, the notifier also uses app-level focus. A multiplexer
pane TTY cannot be compared safely with the host terminal tab's TTY, so the
notifier stays quiet whenever that terminal app is frontmost.

If focus cannot be identified reliably, the notifier stays quiet. This
fail-closed behavior avoids playing the full melody while you are already
watching the response.

Uninstall:

```bash
./scripts/uninstall-macos.sh
```

Only hooks installed by this project are removed.

## Privacy

All detection and playback happens locally. The browser extension reads only
enough page state to identify a new user turn, streaming status, and response
completion. It hashes response text in memory for change detection and never
stores or transmits conversation text.

CLI hooks inspect only event type, pending background-work fields, terminal
focus, and TTY identity. They do not retain prompt or response content.

## Development

The extension and installer intentionally have no third-party runtime
dependencies.

```bash
npm run generate:audio
npm run check
npm test
```

The generated WAV is committed so the unpacked extension and macOS installer
work immediately after cloning.