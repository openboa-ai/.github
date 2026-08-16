#!/usr/bin/env bash
set -euo pipefail

candidate_root="${{1:?candidate repository root is required}"
candidate_tmp="${{RUNNER_TEMP:?}"
uv_root="$candidate_tmp/uv-venv"
harbor_root="$candidate_tmp/harbor-venv"
bench_root="$candidate_tmp/bench-source"
projection_root="$candidate_tmp/bench-projection"
eval_root="$candidate_tmp/eval-oracle"
jobs_root="$eval_root/jobs"
bench_repository="https://github.com/openboa-ai/coffee-chat-bench.git"
bench_commit="1bc71605964770bbd1bd96e049b8412b6ee068fc"
npm_globalconfig="$candidate_tmp/bench-npm-globalconfig"
npm_userconfig="$candidate_tmp/bench-npm-userconfig"

clean_environment=(
  "CI=true"
  "GIT_CONFIG_GLOBAL=/dev/null"
  "GIT_CONFIG_NOSYSTEM=1"
  "GIT_TERMINAL_PROMPT=0"
  "HOME=${{HOME:?}"
  "LANG=${{LANG:-C.UTF-8}"
  "NPM_CONFIG_CACHE=$candidate_tmp/bench-npm-cache"
  "NPM_CONFIG_GLOBALCONFIG=$npm_globalconfig"
  "NPM_CONFIG_REGISTRY=https://registry.npmjs.org"
  "NPM_CONFIG_REPLACE_REGISTRY_HOST=never"
  "NPM_CONFIG_USERCONFIG=$npm_userconfig"
  "PATH=$PATH"
  "PIP_CONFIG_FILE=/dev/null"
  "PIP_DISABLE_PIP_VERSION_CHECK=1"
  "PIP_INDEX_URL=https://pypi.org/simple"
  "RUNNER_TEMP=$candidate_tmp"
  "TMPDIR=${{TMPDIR:-$candidate_tmp}"
  "UV_INDEX_URL=https://pypi.org/simple"
  "UV_NO_CONFIG=1"
)
if test -n "${{DOCKER_HOST:-}"; then
  clean_environment+=("DOCKER_HOST=$DOCKER_HOST")
fi

: > "$npm_globalconfig"
: > "$npm_userconfig"

run_clean() {
  env -i "${{clean_environment[@]}" "$@"
}

run_git() {
  run_clean git -c protocol.file.allow=never -c credential.helper= "$@"
}

test -f "$candidate_root/.github/uv-requirements.txt"
test -f "$candidate_root/.github/harbor-requirements.txt"
test -f "$candidate_root/src/bench.ts"
test -f "$candidate_root/src/cli.ts"
test -f "$candidate_root/src/harbor.ts"
test -f "$candidate_root/src/runner.ts"
test ! -e "$bench_root"
test ! -e "$projection_root"
test ! -e "$eval_root"

mkdir "$bench_root"
run_git init --quiet "$bench_root"
run_git -C "$bench_root" remote add origin "$bench_repository"
run_git -C "$bench_root" fetch --quiet --no-tags --depth=1 origin "$bench_commit"
run_git -C "$bench_root" checkout --quiet --detach FETCH_HEAD
test "$(run_git -C "$bench_root" rev-parse HEAD)" = "$bench_commit"
test -f "$bench_root/package-lock.json"
test -f "$bench_root/harbor/project.ts"
test -d "$bench_root/bank"

run_clean python3 -m venv "$uv_root"
run_clean "$uv_root/bin/python" -m pip install \
  --disable-pip-version-check --require-hashes --no-deps \
  -r "$candidate_root/.github/uv-requirements.txt"
run_clean "$uv_root/bin/uv" venv --python python3 --no-python-downloads \
  "$harbor_root"
run_clean "$uv_root/bin/uv" pip install --require-hashes --no-deps \
  --only-binary :all: --python "$harbor_root/bin/python" \
  -r "$candidate_root/.github/harbor-requirements.txt"

cd "$bench_root"
run_clean npm ci --ignore-scripts --no-audit --no-fund --no-bin-links
run_clean node --experimental-strip-types harbor/project.ts bank "$projection_root"
test -f "$projection_root/projection-manifest.json"

mkdir "$eval_root"
cd "$candidate_root"
run_clean node --experimental-strip-types src/cli.ts oracle-control \
  --projection-root "$projection_root" \
  --case-id "ccbench-ra-s1-dialogue-01" \
  --diagnostic-target a \
  --bench-commit "$bench_commit" \
  --harbor-command "$harbor_root/bin/harbor" \
  --jobs-root "$jobs_root"
test -s "$jobs_root/receipts.json"
