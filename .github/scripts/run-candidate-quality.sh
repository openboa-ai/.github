#!/usr/bin/env bash
set -euo pipefail

repository="${1:?target repository is required}"
candidate_root="${2:?candidate repository root is required}"
candidate_home="${HOME:?}"
candidate_tmp="${RUNNER_TEMP:?}"
npm_globalconfig="$candidate_tmp/npm-globalconfig"
npm_userconfig="$candidate_tmp/npm-userconfig"

: > "$npm_globalconfig"
: > "$npm_userconfig"

candidate_environment=(
  "CI=true"
  "HOME=$candidate_home"
  "LANG=${LANG:-C.UTF-8}"
  "NPM_CONFIG_CACHE=$candidate_tmp/npm-cache"
  "NPM_CONFIG_GLOBALCONFIG=$npm_globalconfig"
  "NPM_CONFIG_REGISTRY=https://registry.npmjs.org"
  "NPM_CONFIG_REPLACE_REGISTRY_HOST=never"
  "NPM_CONFIG_USERCONFIG=$npm_userconfig"
  "PATH=$PATH"
  "PWD=$candidate_root"
  "RUNNER_TEMP=$candidate_tmp"
  "TMPDIR=${TMPDIR:-$candidate_tmp}"
)
if test -n "${DOCKER_HOST:-}"; then
  candidate_environment+=("DOCKER_HOST=$DOCKER_HOST")
fi

run_clean() {
  env -i "${candidate_environment[@]}" "$@"
}

cd "$candidate_root"
run_clean npm ci --ignore-scripts
run_clean npm audit --audit-level=moderate
run_clean npm ci --ignore-scripts --prefix .github/policy-parser
run_clean npm audit --audit-level=moderate --prefix .github/policy-parser

case "$repository" in
  openboa-ai/coffee-chat)
    run_clean npm run format:check
    run_clean npm run typecheck
    run_clean npm test
    run_clean npm run readme:assets:verify
    run_clean npm run build
    run_clean npm run package:smoke
    ;;
  openboa-ai/coffee-chat-roastery)
    run_clean npm run format:check
    run_clean npm run typecheck
    run_clean npm run dist:check
    run_clean npm run repository:check
    run_clean npm run smoke
    run_clean npm run package:check
    ;;
  openboa-ai/coffee-chat-eval)
    run_clean npm run format:check
    run_clean npm run typecheck
    run_clean npm run build
    run_clean npm run canary:check
    run_clean npm test
    run_clean npm run dry-run
    run_clean npm run smoke
    run_clean npm run pcda:calibrate
    ;;
  openboa-ai/coffee-chat-bench)
    run_clean npm run format:check
    run_clean npm run check:inactive
    run_clean npm run typecheck
    run_clean npm test
    ;;
  *)
    echo "unsupported Coffee repository: $repository" >&2
    exit 1
    ;;
esac
