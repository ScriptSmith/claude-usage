#!/bin/bash

# Install script for Claude Usage GNOME extension

EXTENSION_UUID="claude-usage@local"
EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Installing Claude Usage extension..."

# Create extension directory
mkdir -p "$EXTENSION_DIR/schemas"

# Copy files
cp metadata.json "$EXTENSION_DIR/"
cp extension.js "$EXTENSION_DIR/"
cp prefs.js "$EXTENSION_DIR/"
cp credentials.js "$EXTENSION_DIR/"
cp stylesheet.css "$EXTENSION_DIR/"
cp schemas/*.xml "$EXTENSION_DIR/schemas/"
cp claude-session-hook.py "$EXTENSION_DIR/"

# Compile schemas in the extension directory
glib-compile-schemas "$EXTENSION_DIR/schemas/"

# Make hook script executable at installed location
chmod +x "$EXTENSION_DIR/claude-session-hook.py"

HOOK_PATH="$EXTENSION_DIR/claude-session-hook.py"

echo "Extension installed to: $EXTENSION_DIR"
echo ""
echo "To enable the extension:"
echo "  1. Log out and log back in (or press Alt+F2, type 'r', press Enter on X11)"
echo "  2. Enable the extension with: gnome-extensions enable $EXTENSION_UUID"
echo "  3. Or use GNOME Extensions app to enable it"
echo ""
echo "Credentials are read automatically from ~/.claude/.credentials.json"
echo "  - If not authenticated, run: claude auth login"
echo "  - To open preferences: gnome-extensions prefs $EXTENSION_UUID"
echo ""
echo "Hook script installed to: $HOOK_PATH"
echo "  Point your ~/.claude/settings.json hooks to this path."
echo ""
echo "To test it:"
echo "  - Run: dbus-run-session gnome-shell --devkit --wayland"
