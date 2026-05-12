# Claude Usage - GNOME Shell Extension

A GNOME Shell extension that displays Claude AI usage statistics and Claude Code session activity in your top bar.

## Features

### API Usage Monitoring
- **Automatic authentication**: Credentials read from `~/.claude/.credentials.json` — no manual setup
- **Session usage**: 5-hour rolling window utilization percentage
- **Weekly usage**: 7-day rolling window utilization percentage
- **Model breakdowns**: Per-model usage (Sonnet, Opus, Claude Cowork, Claude Design, etc.) shown when active
- **Time remaining**: Countdown until usage resets
- **Color-coded warnings**: Yellow at 75%, red at 90%
- **Configurable refresh interval**: Set how often to poll the API (1-60 minutes)
- **Last updated timestamp**: Shows when usage data was last refreshed

### Claude Code Session Tracking
- **Live status indicator**: Shows single-word status (Thinking, Running, Ready)
- **Last tool**: Shows most recent completed tool with duration (e.g., "Reading: file.js (0.8s)")
- **Session duration**: How long the current session has been active
- **Recent commands**: History of last 5 tools with execution times

## Screenshots

![Screenshot](screenshot.png)

**Top bar display:**
```
Thinking  S: 45%  W: 23%  4h 32m
Running   S: 45%  W: 23%  4h 32m
Ready     S: 45%  W: 23%  4h 32m
```

**Dropdown menu:**
- Claude Code: Thinking
- Session: 45m
- Last: Reading file.js (0.8s)
- Recent Commands >
  - Reading: config.ts (1.2s)
  - Running: npm test (5.3s)
  - Editing: index.js (0.3s)
- ---
- API Usage
- Session: 45% (resets in 4h 32m)
- Weekly: 23% (resets in 5d 12h)
- Last updated: 2 minutes ago

## Requirements

- GNOME Shell 45, 46, 47, 48, 49, or 50
- Python 3 (for Claude Code hooks)
- Claude Pro/Team subscription (for API usage stats)
- Claude Code CLI (for session tracking)

## Installation

### 1. Install the GNOME Extension

```bash
git clone https://github.com/ScriptSmith/claude-usage.git
cd claude-usage
./install.sh
```

Then either:
- Log out and log back in, OR
- Press Alt+F2, type `r`, press Enter (X11 only)

Enable the extension:
```bash
gnome-extensions enable claude-usage@local
```

### 2. Authenticate Claude Code (for usage stats)

Usage stats are fetched using the OAuth token that Claude Code CLI writes to `~/.claude/.credentials.json`. If you've already used Claude Code, you're done — no extra configuration needed.

If you haven't authenticated yet:
```bash
claude auth login
```

You can check whether credentials are detected under **Settings → Authentication** in the extension preferences.

### 3. Set Up Claude Code Hooks (for session tracking)

The extension tracks Claude Code sessions via hooks that write state to `~/.claude/session-state.json`.

#### Make the hook script executable:
```bash
chmod +x ~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py
```

#### Add hooks to your Claude Code settings:

Edit `~/.claude/settings.json` and merge in the hooks configuration:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.local/share/gnome-shell/extensions/claude-usage@local/claude-session-hook.py"
          }
        ]
      }
    ]
  }
}
```

Run `./install.sh` first — it installs the hook script to the extension directory and prints the exact path to use.

A complete hooks configuration is also available in `hooks-config.json` for reference.

## Packing for Distribution

```bash
./pack.sh
```

Produces `claude-usage@local.shell-extension.zip` ready for upload to [extensions.gnome.org](https://extensions.gnome.org) or manual installation via `gnome-extensions install`.

## How It Works

### API Usage Stats
The extension reads the OAuth token from `~/.claude/.credentials.json` and polls `api.anthropic.com/api/oauth/usage` every 10 minutes. The countdown timers update every second. All non-null usage buckets (per-model, per-product) are shown in the dropdown menu.

### Claude Code Session Tracking
The hook script intercepts Claude Code events and writes session state to `~/.claude/session-state.json`. The extension monitors this file for changes and updates the display in real-time.

**Hook events captured:**
| Event | Purpose |
|-------|---------|
| SessionStart | Mark session as active |
| SessionEnd | Mark session as ended |
| UserPromptSubmit | User sent message, Claude is thinking |
| PreToolUse | Tool is about to run |
| PostToolUse | Tool finished, record duration |
| Stop | Claude finished responding |
| SubagentStop | Subagent task completed |

### Privacy: Zero Model Context Pollution

The hooks are designed to be completely invisible to the Claude model:

- **UserPromptSubmit/SessionStart**: Produce zero stdout (these events would add output to model context)
- **Other events**: Output is only visible in verbose mode (Ctrl+O), never seen by the model
- Always exit with code 0 (no blocking)

This means Claude has no idea these hooks exist - your model quality is unaffected.

## Files

```
claude-usage/
├── extension.js          # Main GNOME extension code
├── credentials.js        # Shared OAuth token reader (~/.claude/.credentials.json)
├── prefs.js              # Extension preferences UI
├── metadata.json         # Extension metadata
├── stylesheet.css        # Extension styles
├── schemas/              # GSettings schemas
│   └── org.gnome.shell.extensions.claude-usage.gschema.xml
├── install.sh            # Install extension + hook script locally
├── pack.sh               # Pack extension as .zip for distribution
├── claude-session-hook.py   # Claude Code hook script
├── hooks-config.json     # Example hooks configuration
└── README.md             # This file
```

## Troubleshooting

### Extension not showing
```bash
# Check if enabled
gnome-extensions list --enabled | grep claude-usage

# Check for errors
journalctl -f -o cat /usr/bin/gnome-shell
```

### API usage shows "N/A" or "ERR"
- Run `claude auth login` if you haven't authenticated Claude Code yet
- If you see "Token expired", run `claude auth login` to refresh your credentials
- Check the GNOME Shell log for HTTP errors: `journalctl -f -o cat /usr/bin/gnome-shell`

### Claude Code status not updating
- Ensure the hook script is executable: `chmod +x claude-session-hook.py`
- Verify hooks are in `~/.claude/settings.json`
- Check that `~/.claude/session-state.json` is being created/updated
- Test the hook manually: `echo '{"hook_event_name":"SessionStart","session_id":"test"}' | python3 claude-session-hook.py`

### Session state file permissions
```bash
# Check the file exists and is readable
ls -la ~/.claude/session-state.json
cat ~/.claude/session-state.json
```

## License

MIT
