#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

gnome-extensions pack \
    --extra-source=credentials.js \
    --extra-source=claude-session-hook.py \
    --out-dir="$SCRIPT_DIR" \
    --force \
    "$SCRIPT_DIR"

echo "Packed: $SCRIPT_DIR/claude-usage@local.shell-extension.zip"
