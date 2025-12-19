# Claude Usage - GNOME Shell Extension

A GNOME Shell extension that displays Claude AI usage statistics and Claude Code session activity in your top bar.

## Features

### API Usage Monitoring
- **Session usage**: 5-hour rolling window utilization percentage
- **Weekly usage**: 7-day rolling window utilization percentage
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

- GNOME Shell 45, 46, 47, 48, or 49
- Python 3 (for Claude Code hooks)
- Claude Pro/Team subscription (for API usage stats)
- Claude Code CLI (for session tracking)

## Installation

### 1. Install the GNOME Extension

```bash
cd /path/to/claude-usage
./install.sh
```

Then either:
- Log out and log back in, OR
- Press Alt+F2, type `r`, press Enter (X11 only)

Enable the extension:
```bash
gnome-extensions enable claude-usage@local
```

### 2. Configure API Credentials (for usage stats)

Open the extension preferences:
```bash
gnome-extensions prefs claude-usage@local
```

You'll need to enter:
- **Session Key**: The `sessionKey` cookie from claude.ai
- **Organization ID**: Your organization UUID

To find these:
1. Log into [claude.ai](https://claude.ai) in your browser
2. Open Developer Tools (F12)
3. Go to **Application > Cookies > claude.ai**
4. Copy the `sessionKey` value
5. Go to **Network** tab, find any request to `claude.ai/api`
6. The organization ID is in the URL (e.g., `/api/organizations/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/...`)

### 3. Set Up Claude Code Hooks (for session tracking)

The extension tracks Claude Code sessions via hooks that write state to `~/.claude/session-state.json`.

#### Make the hook script executable:
```bash
chmod +x /path/to/claude-usage/claude-session-hook.py
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
            "command": "/path/to/claude-usage/claude-session-hook.py"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-usage/claude-session-hook.py"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-usage/claude-session-hook.py"
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
            "command": "/path/to/claude-usage/claude-session-hook.py"
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
            "command": "/path/to/claude-usage/claude-session-hook.py"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-usage/claude-session-hook.py"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/claude-usage/claude-session-hook.py"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/claude-usage/` with the actual path where you cloned the repository.

A complete hooks configuration is also available in `hooks-config.json` for reference.

## How It Works

### API Usage Stats
The extension polls the Claude API every 10 minutes to fetch usage statistics. The countdown timers update every second.

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
├── prefs.js              # Extension preferences UI
├── metadata.json         # Extension metadata
├── stylesheet.css        # Extension styles
├── schemas/              # GSettings schemas
│   └── org.gnome.shell.extensions.claude-usage.gschema.xml
├── install.sh            # Installation script
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
- Verify your session key and organization ID are correct
- Session keys expire - you may need to refresh from browser cookies
- Check the GNOME Shell log for HTTP errors

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
