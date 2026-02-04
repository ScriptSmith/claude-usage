#!/usr/bin/env python3
"""
Claude Code session state hook for GNOME extension integration.

This hook writes session state to ~/.claude/session-state.json which
the GNOME extension can watch and display.

Install by adding to ~/.claude/settings.json (see README).
"""

import json
import sys
import os
import fcntl
from datetime import datetime, timezone
from pathlib import Path

STATE_FILE = Path.home() / ".claude" / "session-state.json"
MAX_COMMANDS = 10  # Keep last N commands
CHARS_PER_TOKEN = 4  # Rough approximation for token estimation

def read_state():
    """Read current state file, return empty state if not exists."""
    try:
        if STATE_FILE.exists():
            with open(STATE_FILE, 'r') as f:
                return json.load(f)
    except (json.JSONDecodeError, IOError):
        pass
    return {
        "sessions": {},
        "active_session": None,
    }

def write_state(state):
    """Write state to file with exclusive lock."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, 'w') as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        json.dump(state, f, indent=2, default=str)
        f.flush()
        os.fsync(f.fileno())

def get_session(state, session_id):
    """Get or create session entry."""
    if session_id not in state["sessions"]:
        state["sessions"][session_id] = {
            "id": session_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "idle",
            "current_tool": None,
            "tool_started_at": None,
            "recent_commands": [],
            "cwd": None,
            "last_activity": datetime.now(timezone.utc).isoformat(),
        }
    return state["sessions"][session_id]

def estimate_context_size(transcript_path):
    """Parse transcript file and estimate token count."""
    if not transcript_path:
        return None

    try:
        path = Path(transcript_path)
        if not path.exists():
            return None

        total_chars = 0
        message_count = 0

        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    msg_type = entry.get("type")

                    # Count characters from messages
                    if msg_type == "user":
                        message = entry.get("message", {})
                        if isinstance(message, dict):
                            content = message.get("content", "")
                        else:
                            content = str(message)
                        total_chars += len(str(content))
                        message_count += 1
                    elif msg_type == "assistant":
                        message = entry.get("message", {})
                        if isinstance(message, dict):
                            content = message.get("content", [])
                            if isinstance(content, list):
                                for block in content:
                                    if isinstance(block, dict):
                                        if "text" in block:
                                            total_chars += len(block["text"])
                                        elif "input" in block:
                                            total_chars += len(json.dumps(block["input"]))
                            else:
                                total_chars += len(str(content))
                        message_count += 1
                    elif msg_type == "tool_result":
                        content = entry.get("content", "")
                        # Tool results can be large, count them
                        total_chars += len(str(content))
                except json.JSONDecodeError:
                    continue

        estimated_tokens = total_chars // CHARS_PER_TOKEN
        return {
            "estimated_tokens": estimated_tokens,
            "message_count": message_count,
            "total_chars": total_chars,
        }
    except Exception:
        return None


def format_tool_name(tool_name, tool_input):
    """Create a human-readable description of the tool."""
    descriptions = {
        "Bash": lambda i: f"Running: {i.get('command', '')[:50]}...",
        "Read": lambda i: f"Reading: {os.path.basename(i.get('file_path', ''))}",
        "Write": lambda i: f"Writing: {os.path.basename(i.get('file_path', ''))}",
        "Edit": lambda i: f"Editing: {os.path.basename(i.get('file_path', ''))}",
        "Glob": lambda i: f"Finding: {i.get('pattern', '')}",
        "Grep": lambda i: f"Searching: {i.get('pattern', '')[:30]}",
        "WebFetch": lambda i: f"Fetching: {i.get('url', '')[:40]}",
        "WebSearch": lambda i: f"Searching: {i.get('query', '')[:30]}",
        "Task": lambda i: f"Agent: {i.get('description', 'task')[:30]}",
        "TodoWrite": lambda i: "Updating tasks",
    }

    try:
        if tool_name in descriptions:
            return descriptions[tool_name](tool_input or {})
    except Exception:
        pass
    return f"Tool: {tool_name}"

def handle_session_start(data, state):
    """Handle SessionStart event."""
    session_id = data.get("session_id")
    session = get_session(state, session_id)
    session["status"] = "active"
    session["started_at"] = datetime.now(timezone.utc).isoformat()
    session["cwd"] = data.get("cwd")
    session["last_activity"] = datetime.now(timezone.utc).isoformat()
    state["active_session"] = session_id

    # Clean up old sessions (keep last 5)
    session_ids = list(state["sessions"].keys())
    if len(session_ids) > 5:
        for old_id in session_ids[:-5]:
            if old_id != session_id:
                del state["sessions"][old_id]

def handle_session_end(data, state):
    """Handle SessionEnd event."""
    session_id = data.get("session_id")
    if session_id in state["sessions"]:
        state["sessions"][session_id]["status"] = "ended"
        state["sessions"][session_id]["ended_at"] = datetime.now(timezone.utc).isoformat()
    if state["active_session"] == session_id:
        state["active_session"] = None

def handle_user_prompt_submit(data, state):
    """Handle UserPromptSubmit - user sent a message, Claude is thinking."""
    session_id = data.get("session_id")
    session = get_session(state, session_id)
    session["status"] = "thinking"
    session["current_tool"] = None
    session["last_activity"] = datetime.now(timezone.utc).isoformat()
    session["last_prompt_at"] = datetime.now(timezone.utc).isoformat()
    state["active_session"] = session_id

def handle_pre_tool_use(data, state):
    """Handle PreToolUse - tool is about to run."""
    session_id = data.get("session_id")
    session = get_session(state, session_id)

    tool_name = data.get("tool_name", "Unknown")
    tool_input = data.get("tool_input", {})

    session["status"] = "running_tool"
    session["current_tool"] = {
        "name": tool_name,
        "description": format_tool_name(tool_name, tool_input),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "tool_use_id": data.get("tool_use_id"),
    }
    session["last_activity"] = datetime.now(timezone.utc).isoformat()
    state["active_session"] = session_id

def handle_post_tool_use(data, state):
    """Handle PostToolUse - tool just finished."""
    session_id = data.get("session_id")
    session = get_session(state, session_id)

    tool_name = data.get("tool_name", "Unknown")
    tool_input = data.get("tool_input", {})

    # Add to recent commands
    now = datetime.now(timezone.utc)
    cmd_entry = {
        "tool": tool_name,
        "description": format_tool_name(tool_name, tool_input),
        "completed_at": now.isoformat(),
    }

    # Calculate duration if we have start time
    if session.get("current_tool") and session["current_tool"].get("started_at"):
        try:
            started = datetime.fromisoformat(session["current_tool"]["started_at"].replace('Z', '+00:00'))
            duration_ms = int((now - started).total_seconds() * 1000)
            cmd_entry["duration_ms"] = duration_ms
        except Exception:
            pass

    session["recent_commands"].insert(0, cmd_entry)
    session["recent_commands"] = session["recent_commands"][:MAX_COMMANDS]

    session["status"] = "thinking"
    session["current_tool"] = None
    session["last_activity"] = datetime.now(timezone.utc).isoformat()

def handle_stop(data, state):
    """Handle Stop - Claude finished responding."""
    session_id = data.get("session_id")
    session = get_session(state, session_id)
    session["status"] = "idle"
    session["current_tool"] = None
    session["last_activity"] = datetime.now(timezone.utc).isoformat()

    # Update context size estimate
    transcript_path = data.get("transcript_path")
    context_info = estimate_context_size(transcript_path)
    if context_info:
        session["context"] = context_info

def main():
    try:
        # Read hook input from stdin
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    event = input_data.get("hook_event_name", "")
    state = read_state()

    handlers = {
        "SessionStart": handle_session_start,
        "SessionEnd": handle_session_end,
        "UserPromptSubmit": handle_user_prompt_submit,
        "PreToolUse": handle_pre_tool_use,
        "PostToolUse": handle_post_tool_use,
        "Stop": handle_stop,
        "SubagentStop": handle_stop,
    }

    if event in handlers:
        handlers[event](input_data, state)
        write_state(state)

    # IMPORTANT: UserPromptSubmit and SessionStart stdout goes to model context!
    # Only output for other hook types where stdout is hidden from model.
    context_polluting_events = {"UserPromptSubmit", "SessionStart"}
    if event not in context_polluting_events:
        # For PreToolUse, PostToolUse, Stop, etc. - stdout only shown in verbose mode
        print(json.dumps({"suppressOutput": True}))

    # Exit 0 = success, no blocking
    sys.exit(0)

if __name__ == "__main__":
    main()
