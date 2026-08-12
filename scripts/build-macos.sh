#!/bin/sh
set -eu

fail() {
  printf '%s\n' "BongoCat build failed: $1" >&2
  exit 1
}

bundle_type=${1:-dmg}
case "$bundle_type" in
  app|dmg) ;;
  *) fail "Bundle type must be app or dmg: $bundle_type" ;;
esac

cargo_path=$(rustup which cargo) || fail 'Could not resolve Cargo through rustup.'
rustc_path=$(rustup which rustc) || fail 'Could not resolve rustc through rustup.'
[ -n "$cargo_path" ] || fail 'The Cargo path is empty.'
[ -n "$rustc_path" ] || fail 'The rustc path is empty.'
[ -x "$cargo_path" ] || fail "Cargo is not executable: $cargo_path"
[ -x "$rustc_path" ] || fail "rustc is not executable: $rustc_path"

cargo_dir=$(dirname -- "$cargo_path") || fail 'Could not resolve the Cargo directory.'
rustc_dir=$(dirname -- "$rustc_path") || fail 'Could not resolve the rustc directory.'
[ -d "$cargo_dir" ] || fail "The Cargo directory does not exist: $cargo_dir"
[ "$cargo_dir" = "$rustc_dir" ] \
  || fail 'Cargo and rustc were resolved from different toolchains.'

PATH="$cargo_dir:$PATH"
export PATH

exec pnpm tauri build \
  --target aarch64-apple-darwin \
  --bundles "$bundle_type" \
  --config src-tauri/tauri.macos-build.conf.json \
  --ci \
  --no-sign
