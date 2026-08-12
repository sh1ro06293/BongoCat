#!/bin/sh
set -eu

expected_bundle_id='com.ayangweb.BongoCat'
target_app='/Applications/BongoCat.app'

fail() {
  printf '%s\n' "BongoCat update failed: $1" >&2
  exit 1
}

get_bundle_id() {
  app_path=$1
  info_plist="$app_path/Contents/Info.plist"

  [ -f "$info_plist" ] || return 1
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) \
  || fail 'Could not resolve the script directory.'
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd) \
  || fail 'Could not resolve the project directory.'
source_app="$project_dir/target/aarch64-apple-darwin/release/bundle/macos/BongoCat.app"

[ -n "$project_dir" ] || fail 'The project directory is empty.'
[ ! -L "$source_app" ] || fail 'The build output must not be a symbolic link.'
[ -d "$source_app" ] || fail 'Build output was not found. Run task mac:build first.'
source_bundle_id=$(get_bundle_id "$source_app") \
  || fail 'Could not validate the build output bundle identifier.'
[ "$source_bundle_id" = "$expected_bundle_id" ] \
  || fail 'The build output is not the expected BongoCat application.'

target_exists=false
if [ -e "$target_app" ] || [ -L "$target_app" ]; then
  [ ! -L "$target_app" ] || fail '/Applications/BongoCat.app must not be a symbolic link.'
  [ -d "$target_app" ] || fail '/Applications/BongoCat.app is not an application directory.'
  target_bundle_id=$(get_bundle_id "$target_app") \
    || fail 'Could not validate the installed application bundle identifier.'
  [ "$target_bundle_id" = "$expected_bundle_id" ] \
    || fail 'The installed application is not the expected BongoCat application.'
  target_exists=true
fi

timestamp=$(date '+%Y%m%d-%H%M%S') || fail 'Could not create an update timestamp.'
[ -n "$timestamp" ] || fail 'The update timestamp is empty.'
staged_app="/Applications/.BongoCat-update-$timestamp.app"
backup_app="/private/tmp/BongoCat-before-update-$timestamp.app"

case "$staged_app" in
  /Applications/.BongoCat-update-*.app) ;;
  *) fail 'The staging path is outside /Applications.' ;;
esac
case "$backup_app" in
  /private/tmp/BongoCat-before-update-*.app) ;;
  *) fail 'The backup path is outside /private/tmp.' ;;
esac

[ ! -e "$staged_app" ] && [ ! -L "$staged_app" ] \
  || fail "The staging path already exists: $staged_app"
[ ! -e "$backup_app" ] && [ ! -L "$backup_app" ] \
  || fail "The backup path already exists: $backup_app"

ditto "$source_app" "$staged_app" \
  || fail "Could not stage the application at $staged_app"
codesign --force --deep --sign - "$staged_app" \
  || fail "Could not apply an ad-hoc signature to $staged_app"
codesign --verify --deep --strict "$staged_app" \
  || fail "The staged application failed signature verification: $staged_app"

if pgrep -x bongo-cat >/dev/null 2>&1; then
  osascript -e 'tell application id "com.ayangweb.BongoCat" to quit' \
    || fail 'Could not ask the running BongoCat application to quit.'

  wait_count=0
  while pgrep -x bongo-cat >/dev/null 2>&1; do
    [ "$wait_count" -lt 40 ] \
      || fail 'BongoCat did not quit within 10 seconds. Close it manually and retry.'
    sleep 0.25
    wait_count=$((wait_count + 1))
  done
fi

backup_created=false
if [ "$target_exists" = true ]; then
  mv "$target_app" "$backup_app" \
    || fail "Could not move the installed application to $backup_app"
  backup_created=true
fi

if ! mv "$staged_app" "$target_app"; then
  if [ "$backup_created" = true ] && [ ! -e "$target_app" ] && [ ! -L "$target_app" ]; then
    mv "$backup_app" "$target_app" \
      || printf '%s\n' "Could not restore the previous application from $backup_app" >&2
  fi
  fail 'Could not install the staged application.'
fi

open "$target_app" || fail 'The application was installed but could not be opened.'

printf '%s\n' "BongoCat was updated: $target_app"
if [ "$backup_created" = true ]; then
  printf '%s\n' "Previous version backup: $backup_app"
fi
