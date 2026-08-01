#!/bin/sh
set -eu

bin_dir="$HOME/.local/bin"
notifier="$bin_dir/bongocat-notify"
codex_dir="$HOME/.codex"
codex_config="$codex_dir/config.toml"

mkdir -p "$bin_dir" "$codex_dir"
chmod +x "$notifier"
touch "$codex_config"
cp "$codex_config" "$codex_config.bak"

notify_line="notify = [\"/bin/sh\", \"$notifier\", \"codex\"]"
temporary_config="$codex_config.tmp.$$"

awk -v notify_line="$notify_line" '
  /^notify[[:space:]]*=/ { next }
  !inserted && /^\[/ {
    print notify_line
    print ""
    inserted = 1
  }
  { print }
  END {
    if (!inserted) {
      print notify_line
    }
  }
' "$codex_config" >"$temporary_config"

mv "$temporary_config" "$codex_config"

if command -v python3 >/dev/null 2>&1; then
  python3 - "$codex_dir/hooks.json" "$notifier" <<'PY'
import json
import pathlib
import shutil
import sys

hooks_path = pathlib.Path(sys.argv[1])
notifier = sys.argv[2]

if hooks_path.exists():
    shutil.copy2(hooks_path, hooks_path.with_suffix(hooks_path.suffix + ".bak"))
    with hooks_path.open(encoding="utf-8") as file:
        settings = json.load(file)
else:
    settings = {}

command = f'/bin/sh "{notifier}" codex'
hooks = settings.setdefault("hooks", {})
groups = hooks.setdefault("PermissionRequest", [])
already_configured = any(
    hook.get("command") == command
    for group in groups
    for hook in group.get("hooks", [])
    if isinstance(hook, dict)
)

if not already_configured:
    groups.append({
        "hooks": [{
            "type": "command",
            "command": command,
            "timeout": 3,
            "statusMessage": "Notifying BongoCat",
        }]
    })

with hooks_path.open("w", encoding="utf-8") as file:
    json.dump(settings, file, ensure_ascii=False, indent=2)
    file.write("\n")
PY
fi

if command -v python3 >/dev/null 2>&1; then
  mkdir -p "$HOME/.claude"
  python3 - "$HOME/.claude/settings.json" "$notifier" <<'PY'
import json
import pathlib
import shutil
import sys

settings_path = pathlib.Path(sys.argv[1])
notifier = sys.argv[2]
backup_path = settings_path.with_suffix(settings_path.suffix + ".bak")
if settings_path.exists():
    shutil.copy2(settings_path, backup_path)
    with settings_path.open(encoding="utf-8") as file:
        settings = json.load(file)
else:
    settings = {}

command = f'/bin/sh "{notifier}" claude'
hooks = settings.setdefault("hooks", {})

for event in ("Notification", "Stop", "StopFailure"):
    groups = hooks.setdefault(event, [])
    already_configured = any(
        hook.get("command") == command
        for group in groups
        for hook in group.get("hooks", [])
        if isinstance(hook, dict)
    )
    if not already_configured:
        groups.append({"hooks": [{"type": "command", "command": command}]})

with settings_path.open("w", encoding="utf-8") as file:
    json.dump(settings, file, ensure_ascii=False, indent=2)
    file.write("\n")
PY
fi

printf '%s\n' "BongoCat remote hooks installed."
