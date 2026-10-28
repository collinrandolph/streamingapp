#!/usr/bin/env bash
# Makes the key the Android app is signed with, once. Every build must use the same key, or Android won't
# install an update over the app you have. Keep the folder it writes somewhere safe, outside the repo.
# Usage: bash tools/make-android-key.sh <folder>
# Then add two repository secrets on GitHub (Settings › Secrets and variables › Actions):
#   ANDROID_KEYSTORE           the contents of keystore-base64.txt
#   ANDROID_KEYSTORE_PASSWORD  the contents of password.txt
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would otherwise turn /CN=… into a path
DIR="${1:?Give a folder to write the key to}"
if [ -e "$DIR/tracker.p12" ]; then echo "$DIR already has a key; not replacing it." >&2; exit 1; fi
mkdir -p "$DIR"
PASS=$(openssl rand -hex 16)
printf '%s' "$PASS" > "$DIR/password.txt"
openssl req -x509 -newkey rsa:4096 -sha256 -days 10000 -nodes -subj "/CN=Streaming Tracker" \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" 2>/dev/null
openssl pkcs12 -export -name tracker -inkey "$DIR/key.pem" -in "$DIR/cert.pem" \
  -out "$DIR/tracker.p12" -passout "pass:$PASS"
rm "$DIR/key.pem"
base64 -w0 "$DIR/tracker.p12" > "$DIR/keystore-base64.txt"
echo "Wrote the key to $DIR"
