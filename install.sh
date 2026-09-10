#!/usr/bin/env bash
# Install the extension into ~/.local/share/gnome-shell/extensions.
# Usage: ./install.sh [enable]
set -euo pipefail

cd "$(dirname "$0")"
UUID="next-event-calendar@gnome-shell-extension"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
mkdir -p "$DEST"
cp metadata.json extension.js prefs.js stylesheet.css "$DEST/"
cp -r schemas "$DEST/"
glib-compile-schemas "$DEST/schemas"

echo "Installed to $DEST"
echo "Restart GNOME Shell:"
echo "  X11:     Alt+F2 -> r"
echo "  Wayland: log out and log back in"

if [[ "${1:-}" == "enable" ]]; then
    gnome-extensions enable "$UUID" && echo "Enabled $UUID"
fi
