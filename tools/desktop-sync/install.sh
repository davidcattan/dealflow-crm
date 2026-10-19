#!/bin/bash
# Installs the JED CRM Desktop sync on this Mac: files saved in
# ~/Desktop/JED/Deals/<Deal folder>/ upload to that deal in the CRM.
# Run it again any time to update the helper or replace the CRM key.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/JED CRM Sync"
LABEL="com.jedcapital.crm-desktop-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVICE="JED CRM Desktop Sync"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "Node isn't installed. Install it from nodejs.org, then run this again."
  exit 1
fi

mkdir -p "$APP" "$HOME/Library/LaunchAgents"
cp "$HERE/jed-desktop-sync.mjs" "$APP/jed-desktop-sync.mjs"

if [ "${1:-}" = "--new-key" ] || ! security find-generic-password -s "$SERVICE" -w >/dev/null 2>&1; then
  echo "Paste your CRM key (CRM → Settings → make a key). It won't show as you paste."
  read -r -s KEY
  echo
  case "$KEY" in
    jed_*) ;;
    *) echo "That doesn't look like a CRM key (they start with jed_)."; exit 1 ;;
  esac
  security add-generic-password -U -s "$SERVICE" -a "$USER" -w "$KEY"
  echo "Key saved in your Keychain."
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP/jed-desktop-sync.mjs</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$APP/launchd.log</string>
  <key>StandardErrorPath</key><string>$APP/launchd.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Every minute, new files in ~/Desktop/JED/Deals/<Deal>/ go to that deal in the CRM."
echo "Activity log: $APP/sync.log"
