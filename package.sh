#!/usr/bin/env bash
# Build a distributable GNOME Shell extension zip.
# Usage: ./package.sh   -> creates dist/next-event-calendar@gnome-shell-extension.shell-extension.zip

set -euo pipefail

cd "$(dirname "$0")"
UUID="next-event-calendar@gnome-shell-extension"
DIST="dist"

# Compile schemas into a staging dir so the zip ships gschemas.compiled
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -r metadata.json extension.js prefs.js stylesheet.css "$STAGE/"
mkdir -p "$STAGE/schemas"
cp schemas/org.gnome.shell.extensions.next-event-calendar.gschema.xml "$STAGE/schemas/"
glib-compile-schemas "$STAGE/schemas"

mkdir -p "$DIST"
OUT="$DIST/${UUID}.shell-extension.zip"
rm -f "$OUT"

cd "$STAGE"
zip -r -q "$OLDPWD/$OUT" .

cd "$OLDPWD"
echo "Created $OUT"
