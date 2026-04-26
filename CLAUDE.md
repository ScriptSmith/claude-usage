# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A GNOME Shell extension that displays Claude AI usage statistics and Claude Code session activity in the top panel. It consists of two main components:

1. **GNOME Shell Extension** (JavaScript/GJS) - Displays usage stats and session status in the top bar
2. **Claude Code Hook Script** (Python) - Captures session events and writes state to `~/.claude/session-state.json`

## Development Commands

### Install extension locally
```bash
./install.sh
```

### Enable/disable extension
```bash
gnome-extensions enable claude-usage@local
gnome-extensions disable claude-usage@local
```

### Open preferences
```bash
gnome-extensions prefs claude-usage@local
```

### View extension logs
```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

### Test hook script
```bash
echo '{"hook_event_name":"SessionStart","session_id":"test"}' | python3 claude-session-hook.py
```

### Compile GSettings schemas (done by install.sh)
```bash
glib-compile-schemas ~/.local/share/gnome-shell/extensions/claude-usage@local/schemas/
```

## Architecture

### Extension (extension.js)
- `ClaudeUsageIndicator` class extends `PanelMenu.Button` - the main panel widget
- Uses `Soup.Session` for HTTP requests to Claude API (`/api/organizations/{orgId}/usage`)
- Uses `Gio.FileMonitor` to watch `~/.claude/session-state.json` for real-time updates
- Settings stored via GSettings schema in `schemas/` directory
- Countdown timers update every second; API polling configurable (default 10 minutes)
- API polling only occurs when there's an active Claude Code session

### Hook Script (claude-session-hook.py)
- Receives hook events via stdin as JSON
- Maintains session state across multiple concurrent sessions
- Supports events: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStop
- Uses file locking (`fcntl.LOCK_EX`) for atomic state file writes
- Estimates context size by parsing transcript files (JSONL format)
- **Context pollution rule**: UserPromptSubmit and SessionStart must produce no stdout (output goes to model context); other events can output `{"suppressOutput": true}`

### Key Files
- `extension.js` - Main extension code with panel indicator
- `prefs.js` - Adw-based preferences UI
- `claude-session-hook.py` - Python hook that writes session state
- `schemas/*.xml` - GSettings schema for credentials and settings
- `stylesheet.css` - Warning/danger color classes for usage thresholds

### State File Format (~/.claude/session-state.json)
```json
{
  "sessions": {
    "session-id": {
      "status": "thinking|running_tool|idle|ended",
      "current_tool": { "name": "...", "description": "...", "started_at": "..." },
      "recent_commands": [...],
      "context": { "estimated_tokens": N, "message_count": N }
    }
  },
  "active_session": "session-id"
}
```

## GNOME Extension Development Notes

- Uses GJS imports: GLib, GObject, Gio, Soup (v3.0), St, Clutter
- Extension must export `enable()` and `disable()` functions
- Preferences use libadwaita (Adw) widgets
- Supports GNOME Shell versions 45-50
