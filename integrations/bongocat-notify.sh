#!/bin/sh

provider="${1:-codex}"

if [ "$#" -ge 2 ]; then
  payload=''
  for argument in "$@"; do
    payload=$argument
  done
else
  payload=$(cat)
fi

if [ -z "$payload" ]; then
  payload='{}'
fi

if command -v curl >/dev/null 2>&1 &&
  curl \
    --fail \
    --silent \
    --show-error \
    --max-time 2 \
    --header 'Content-Type: application/json' \
    --request POST \
    --data-binary "$payload" \
    "http://127.0.0.1:${BONGOCAT_RELAY_PORT:-39284}/notify/$provider" \
    >/dev/null 2>&1
then
  exit 0
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
payload_hex=$(printf '%s' "$payload" | od -An -tx1 | tr -d ' \n')

for candidate in \
  "${BONGOCAT_PATH:-}" \
  "/Applications/BongoCat.app/Contents/MacOS/bongo-cat" \
  "/Applications/BongoCat.app/Contents/MacOS/BongoCat" \
  "$HOME/Applications/BongoCat.app/Contents/MacOS/bongo-cat" \
  "$HOME/Applications/BongoCat.app/Contents/MacOS/BongoCat" \
  "$script_dir/../target/release/bongo-cat" \
  "$script_dir/../target/debug/bongo-cat"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    "$candidate" \
      --ai-notify-source "$provider" \
      --ai-notify-payload "$payload_hex" \
      >/dev/null 2>&1 &
    exit 0
  fi
done

exit 0
