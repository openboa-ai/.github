#!/usr/bin/env bash
set -euo pipefail

candidate_root="${1:?candidate repository root is required}"
index_entries="$(mktemp)"
trap 'rm -f "$index_entries"' EXIT

git -C "$candidate_root" ls-files -s > "$index_entries"
if awk '$1 == "120000" { found = 1 } END { exit !found }' "$index_entries"; then
  echo 'candidate symlinks are not allowed across the trusted data boundary' >&2
  exit 1
fi
if awk '$1 == "160000" { found = 1 } END { exit !found }' "$index_entries"; then
  echo 'candidate gitlinks are not allowed across the trusted data boundary' >&2
  exit 1
fi

test ! -e "$candidate_root/.npmrc"
test ! -e "$candidate_root/.github/policy-parser/.npmrc"
test ! -e "$candidate_root/npm-shrinkwrap.json"
test ! -L "$candidate_root/package.json"
test ! -L "$candidate_root/package-lock.json"
