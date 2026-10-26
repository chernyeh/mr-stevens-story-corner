#!/bin/bash
# One-time setup on your Mac: lets the Story Corner website use the Phonon
# voices in Ollama, and keeps that permission after every restart.
#
#   Set up:  bash ~/Downloads/setup-phonon-voices.sh
#   Undo:    bash ~/Downloads/setup-phonon-voices.sh --remove
#
# Running it again replaces the saved address(es) with the new ones.

LABEL="com.mrstevens.ollama-origins"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

restart_ollama() {
  if pgrep -xq Ollama; then
    osascript -e 'quit app "Ollama"' >/dev/null 2>&1
    sleep 3
  fi
  if open -a Ollama >/dev/null 2>&1; then
    echo "Ollama restarted."
  else
    echo "Couldn't find the Ollama app - install it from ollama.com/download, then open it."
  fi
}

if [ "$1" = "--remove" ]; then
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1
  rm -f "$PLIST"
  launchctl unsetenv OLLAMA_ORIGINS
  restart_ollama
  echo "Removed. Your story site can no longer use Ollama on this Mac."
  exit 0
fi

echo
echo "Paste your story site's address, e.g. https://mr-stevens-story-corner.vercel.app"
echo "(If it has more than one address, separate them with commas.)"
read -r -p "Address: " INPUT

# Tidy each address into exactly the form Ollama needs: https://host, no path
ORIGINS=""
IFS=',' read -ra PARTS <<< "$INPUT"
for p in "${PARTS[@]}"; do
  p="$(printf '%s' "$p" | tr -d '[:space:]')"
  [ -z "$p" ] && continue
  case "$p" in
    http://*|https://*) ;;
    *) p="https://$p" ;;
  esac
  p="$(printf '%s' "$p" | sed -E 's|^(https?://[^/?#]+).*|\1|')"
  ORIGINS="${ORIGINS:+$ORIGINS,}$p"
done

if [ -z "$ORIGINS" ]; then
  echo "No address entered - nothing was changed."
  exit 1
fi

# A login item that re-applies the permission at every login. Ollama may
# already have started by then, so it is restarted to pick the setting up.
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>launchctl setenv OLLAMA_ORIGINS '$ORIGINS'; if pgrep -xq Ollama; then osascript -e 'quit app "Ollama"'; sleep 3; open -a Ollama; fi</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

# Apply now as well, without waiting for the next login
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
restart_ollama

echo
echo "Done. Ollama now trusts: $ORIGINS"
echo "This stays in place after restarts - you don't need to run it again."
