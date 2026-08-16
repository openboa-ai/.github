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
run_clean npm ci --ignore-scripts --no-bin-links
run_clean npm audit --audit-level=moderate
run_clean npm ci --ignore-scripts --no-bin-links --prefix .github/policy-parser
run_clean npm audit --audit-level=moderate --prefix .github/policy-parser

case "$repository" in
  openboa-ai/coffee-chat)
    run_clean node node_modules/prettier/bin/prettier.cjs --check .
    run_clean node node_modules/typescript/bin/tsc --noEmit
    run_clean node --test tests/*.test.mjs
    run_clean node scripts/verify-readme-assets.mjs
    run_clean node scripts/build-package.mjs
    run_clean node scripts/package-smoke.mjs
    ;;
  openboa-ai/coffee-chat-roastery)
    run_clean node node_modules/prettier/bin/prettier.cjs --check .
    run_clean node node_modules/typescript/bin/tsc --noEmit
    run_clean node scripts/build.mjs
    run_clean git diff --exit-code -- dist
    run_clean node scripts/check-repository-state.mjs --root .
    run_clean node --test tests/*.test.mjs
    run_clean node scripts/check-package.mjs
    ;;
  openboa-ai/coffee-chat-eval)
    run_clean npm run format:check
    run_clean npm run typecheck
    run_clean npm test
    run_clean npm run dry-run
    run_clean npm run smoke
    run_clean npm run ci:policy
    ;;
  openboa-ai/coffee-chat-bench)
    run_clean node node_modules/prettier/bin/prettier.cjs --check package.json package-lock.json tsconfig.json prettier.config.mjs docs/quality-map.md docs/validity/*.md perspectives/*.json "bank/**/*.json" schemas/*.json scripts/*.mjs src/*.ts tests/*.test.mjs tests/*.test.ts tests/fixtures/**/*.json tests/fixtures/projection/artifacts/echo.json tests/fixtures/projection/artifacts/judgment-access.json tests/fixtures/projection/artifacts/list-all.json tests/fixtures/projection/artifacts/no-op.json tests/fixtures/projection/artifacts/oracle.json
    run_clean node scripts/check-inactive-boundary.mjs --root .
    run_clean node node_modules/typescript/bin/tsc --noEmit
    run_clean node --experimental-strip-types --test tests/*.test.mjs tests/*.test.ts
    ;;
  *)
    echo "unsupported Coffee repository: $repository" >&2
    exit 1
    ;;
esac
