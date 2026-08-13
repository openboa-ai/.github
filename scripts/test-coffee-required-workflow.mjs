import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const workflowPath = resolve(root, ".github/workflows/coffee-trusted-gate.yml");
const workflow = readFileSync(workflowPath, "utf8");
const authorityCheck = resolve(
  root,
  ".github/scripts/reject-candidate-authorities.sh",
);

test("trusted gate uses only the ruleset-supported pull request event", () => {
  assert.match(workflow, /^on:\n  pull_request:\s*$/mu);
  assert.doesNotMatch(workflow, /^concurrency:/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /openboa-ai\/coffee-chat-bench/gu);
  assert.doesNotMatch(workflow, /github\.repository != ''/u);
});

test("candidate is data and all controls come from immutable trusted commits", () => {
  const sourceCheckout = workflow.indexOf("ref: ${{ github.workflow_sha }}");
  const baseCheckout = workflow.indexOf(
    "ref: ${{ github.event.pull_request.base.sha }}",
  );
  const candidateCheckout = workflow.indexOf(
    "ref: ${{ github.event.pull_request.head.sha }}",
  );
  const policy = workflow.indexOf(
    'node "$GITHUB_WORKSPACE/trusted-target/.github/ci-policy.mjs"',
  );
  assert.ok(sourceCheckout > 0);
  assert.ok(baseCheckout > sourceCheckout);
  assert.ok(candidateCheckout > baseCheckout);
  assert.ok(policy > candidateCheckout);
  assert.match(workflow, /repository: openboa-ai\/\.github/u);
  assert.match(workflow, /path: control/u);
  assert.match(workflow, /path: trusted-target/u);
  assert.match(workflow, /path: candidate/u);
  assert.match(workflow, /persist-credentials: false/gu);
});

test("trusted gate rejects alternate npm authority before any candidate install", () => {
  assert.match(
    workflow,
    /control\/\.github\/scripts\/reject-candidate-authorities\.sh/u,
  );
  assert.doesNotMatch(workflow, /npm ci --[^\n]*prefix candidate/u);
  assert.doesNotMatch(workflow, /working-directory:\s*candidate/u);
  assert.doesNotMatch(workflow, /npm run/u);
});

test("trusted gate rejects candidate symlink escapes before reading data", () => {
  const rejection = workflow.indexOf("reject-candidate-authorities.sh");
  const secretScan = workflow.indexOf(
    "Scan candidate history, worktree, and raw blobs",
  );
  const policy = workflow.indexOf(
    "Enforce trusted base policy against candidate data",
  );
  assert.ok(rejection > 0);
  assert.ok(rejection < secretScan);
  assert.ok(rejection < policy);
});

test("authority check rejects an early symlink in a large Git index", () => {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-authority-check-"));
  try {
    execFileSync("git", ["init", "-q", fixture]);
    writeFileSync(join(fixture, "package.json"), "{}\n");
    writeFileSync(join(fixture, "package-lock.json"), "{}\n");
    symlinkSync("package.json", join(fixture, "000-escape"));
    const bulk = join(fixture, "bulk");
    mkdirSync(bulk);
    for (let index = 0; index < 5000; index += 1) {
      writeFileSync(join(bulk, `${String(index).padStart(5, "0")}.txt`), "x\n");
    }
    execFileSync("git", ["-C", fixture, "add", "."]);
    const result = spawnSync(authorityCheck, [fixture], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /candidate symlinks are not allowed/u);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("trusted gate clears Node injection paths and resolves parser from base", () => {
  assert.match(workflow, /NODE_OPTIONS: ""/u);
  assert.match(workflow, /NODE_PATH: ""/u);
  assert.match(
    workflow,
    /NPM_CONFIG_REGISTRY: https:\/\/registry\.npmjs\.org/u,
  );
  assert.match(workflow, /NPM_CONFIG_REPLACE_REGISTRY_HOST: never/u);
  assert.match(
    workflow,
    /npm ci --ignore-scripts --prefix "\$GITHUB_WORKSPACE\/trusted-target\/\.github\/policy-parser"/u,
  );
  for (const rootVariable of [
    "CI_POLICY_ROOT",
    "ROASTERY_CI_POLICY_ROOT",
    "EVAL_CI_POLICY_ROOT",
    "BENCH_CI_POLICY_ROOT",
  ]) {
    assert.match(
      workflow,
      new RegExp(
        `${rootVariable}: \\$\\{\\{ github\\.workspace \\}\\}/candidate`,
        "u",
      ),
    );
  }
});

test("trusted gate scans secrets, dependencies, and CodeQL without candidate code", () => {
  assert.match(workflow, /control\/\.github\/scripts\/install-gitleaks\.sh/u);
  assert.match(workflow, /gitleaks git/u);
  assert.match(workflow, /git -C candidate cat-file blob/u);
  assert.match(
    workflow,
    /actions\/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294/u,
  );
  assert.match(workflow, /build-mode: none/u);
  assert.match(workflow, /security-events: write/u);
  assert.match(workflow, /needs: authorize/gu);
  assert.doesNotMatch(workflow, /pull_request_target/u);
});
