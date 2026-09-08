#!/usr/bin/env bash
set -euo pipefail
version=1.7.12
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) platform=linux_amd64; digest=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Darwin-arm64) platform=darwin_arm64; digest=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  *) echo 'Unsupported actionlint platform' >&2; exit 1 ;;
esac
install_dir="${RUNNER_TEMP:?}/actionlint-$version"
mkdir -p "$install_dir"
archive="$install_dir/archive.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/rhysd/actionlint/releases/download/v$version/actionlint_${version}_${platform}.tar.gz" --output "$archive"
printf '%s  %s\n' "$digest" "$archive" | shasum -a 256 --check
tar -xzf "$archive" -C "$install_dir" actionlint
if test -n "${GITHUB_PATH:-}"; then printf '%s\n' "$install_dir" >> "$GITHUB_PATH"; fi
printf '%s\n' "$install_dir/actionlint"
