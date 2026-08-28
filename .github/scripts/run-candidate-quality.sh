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

legacy_bench_layout() {
  test -f evals/output-quality/perspective-capture/.gitkeep || return 1
  test -f evals/output-quality/perspective-application/human-understanding/.gitkeep || return 1
  test -f evals/output-quality/perspective-application/agent-judgment-action/.gitkeep || return 1
  test -f evals/triggering/perspective-capture/.gitkeep || return 1
  test -f evals/triggering/perspective-application/.gitkeep || return 1
  test ! -e DATA-CARD.md || return 1
  test ! -e PREREGISTRATION.md || return 1
  test ! -e evals/skill-triggering || return 1
  test ! -e evals/output-quality/preference-inference || return 1
  test ! -e evals/output-quality/personalized-response-generation || return 1
  test ! -e evals/output-quality/personalized-task-execution || return 1
}

current_bench_layout() {
  test -f PREREGISTRATION.md || return 1
  for task in \
    preference-inference \
    personalized-response-generation \
    personalized-task-execution
  do
    test -d "evals/output-quality/$task/development" || return 1
    test -d "evals/output-quality/$task/validation" || return 1
  done
  test -d evals/skill-triggering/development || return 1
  test -d evals/skill-triggering/validation || return 1
  test ! -e evals/output-quality/perspective-capture || return 1
  test ! -e evals/output-quality/perspective-application || return 1
  test ! -e evals/triggering || return 1
}

zero_base_layout() {
  case "$repository" in
    openboa-ai/coffee-chat)
      test -f plugin.json || return 1
      test -f skills/roast/SKILL.md || return 1
      test -f skills/brew/SKILL.md || return 1
      ;;
    openboa-ai/coffee-chat-roastery)
      test -f origins/.gitkeep || return 1
      test -f beans/.gitkeep || return 1
      ;;
    openboa-ai/coffee-chat-eval)
      test -f iterations/README.md || return 1
      ;;
    openboa-ai/coffee-chat-bench)
      test -f evals/README.md || return 1
      test -f graders/README.md || return 1
      test -f research/README.md || return 1
      legacy_bench_layout || current_bench_layout
      ;;
    *)
      return 1
      ;;
  esac
}

cd "$candidate_root"
run_clean npm ci --ignore-scripts --no-bin-links
run_clean npm audit --audit-level=moderate

if test ! -f .github/policy-parser/package.json; then
  if ! zero_base_layout; then
    echo "candidate is neither a legacy Coffee repository nor a recognized zero-base layout" >&2
    exit 1
  fi
  exit 0
fi

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
    run_clean node node_modules/prettier/bin/prettier.cjs --check .
    run_clean node node_modules/typescript/bin/tsc --noEmit
    run_clean npm test
    run_clean npm run dry-run
    run_clean npm run smoke
    run_clean npm run ci:policy
    ;;
  openboa-ai/coffee-chat-bench)
    run_clean node node_modules/prettier/bin/prettier.cjs --check AGENTS.md README.md DATA-CARD.md PREREGISTRATION.md OVERLAP-REPORT.json package.json package-lock.json tsconfig.json prettier.config.mjs docs/*.md docs/validity/*.md harbor/*.md qualification/*.md qualification/*.json "bank/**/*.json" harbor/*.ts schemas/*.json scripts/*.mjs src/*.ts tests/*.mjs tests/*.ts
    run_clean node scripts/check-inactive-boundary.mjs --root .
    run_clean node node_modules/typescript/bin/tsc --noEmit
    run_clean node --experimental-strip-types --test tests/*.test.mjs tests/*.test.ts
    ;;
  *)
    echo "unsupported Coffee repository: $repository" >&2
    exit 1
    ;;
esac
