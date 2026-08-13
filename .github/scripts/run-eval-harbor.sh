#!/usr/bin/env bash
set -euo pipefail

candidate_root="${1:?candidate repository root is required}"
candidate_tmp="${RUNNER_TEMP:?}"
uv_root="$candidate_tmp/uv-venv"
harbor_root="$candidate_tmp/harbor-venv"

clean_environment=(
  "CI=true"
  "HOME=${HOME:?}"
  "LANG=${LANG:-C.UTF-8}"
  "PATH=$PATH"
  "PIP_CONFIG_FILE=/dev/null"
  "PIP_DISABLE_PIP_VERSION_CHECK=1"
  "PIP_INDEX_URL=https://pypi.org/simple"
  "RUNNER_TEMP=$candidate_tmp"
  "TMPDIR=${TMPDIR:-$candidate_tmp}"
  "UV_INDEX_URL=https://pypi.org/simple"
  "UV_NO_CONFIG=1"
)
if test -n "${DOCKER_HOST:-}"; then
  clean_environment+=("DOCKER_HOST=$DOCKER_HOST")
fi

run_clean() {
  env -i "${clean_environment[@]}" "$@"
}

test -f "$candidate_root/.github/uv-requirements.txt"
test -f "$candidate_root/.github/harbor-requirements.txt"
test -f "$candidate_root/src/canary-cli.ts"
test -f "$candidate_root/src/harbor.ts"

run_clean python3 -m venv "$uv_root"
run_clean "$uv_root/bin/python" -m pip install \
  --disable-pip-version-check --require-hashes --no-deps \
  -r "$candidate_root/.github/uv-requirements.txt"
run_clean "$uv_root/bin/uv" venv --python python3 --no-python-downloads \
  "$harbor_root"
run_clean "$uv_root/bin/uv" pip install --require-hashes --no-deps \
  --only-binary :all: --python "$harbor_root/bin/python" \
  -r "$candidate_root/.github/harbor-requirements.txt"

cd "$candidate_root"
env -i "${clean_environment[@]}" \
  "HARBOR_COMMAND=$harbor_root/bin/harbor" \
  node --experimental-strip-types src/canary-cli.ts calibrate
env -i "${clean_environment[@]}" \
  "HARBOR_COMMAND=$harbor_root/bin/harbor" \
  node --experimental-strip-types src/canary-cli.ts benchmark-calibrate
