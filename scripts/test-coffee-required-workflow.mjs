import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  renameSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  classifyCandidate,
  validateCandidateWorkflowDelegation,
} from "../.github/scripts/classify-candidate.mjs";

const root = resolve(import.meta.dirname, "..");
const workflowPath = resolve(root, ".github/workflows/coffee-trusted-gate.yml");
const workflow = readFileSync(workflowPath, "utf8");
const authorityCheck = resolve(
  root,
  ".github/scripts/reject-candidate-authorities.sh",
);
const qualityRunnerPath = resolve(
  root,
  ".github/scripts/run-candidate-quality.sh",
);
const qualityRunner = readFileSync(qualityRunnerPath, "utf8");
const evalHarborRunner = readFileSync(
  resolve(root, ".github/scripts/run-eval-harbor.sh"),
  "utf8",
);

function commit(repository, message) {
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "-qm", message]);
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function trustedWrapper(controlSha) {
  return `name: OpenBoa Coffee trusted gate

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

jobs:
  trusted:
    name: OpenBoa Coffee trusted required
    permissions:
      actions: read
      contents: read
      security-events: write
    uses: openboa-ai/.github/.github/workflows/coffee-trusted-gate.yml@${controlSha}
    with:
      control_sha: ${controlSha}
`;
}

function classificationFixture(mutate) {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-classifier-"));
  const candidate = join(fixture, "candidate");
  const trusted = join(fixture, "trusted");
  mkdirSync(candidate);
  mkdirSync(join(trusted, ".github"), { recursive: true });
  execFileSync("git", ["init", "-q", candidate]);
  execFileSync("git", ["-C", candidate, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", candidate, "config", "user.name", "Policy test"]);
  mkdirSync(join(candidate, "src"));
  mkdirSync(join(candidate, ".github/workflows"), { recursive: true });
  writeFileSync(join(candidate, "README.md"), "base\n");
  writeFileSync(join(candidate, "src/control.ts"), "export const control = true;\n");
  writeFileSync(
    join(candidate, ".github/workflows/trusted.yml"),
    trustedWrapper("a".repeat(40)),
  );
  const baseSha = commit(candidate, "base");
  writeFileSync(
    join(trusted, ".github/merge-policy.json"),
    `${JSON.stringify({ protected_paths: ["/src/**", "/.github/**"] })}\n`,
  );
  mutate(candidate);
  const headSha = commit(candidate, "candidate");
  return { baseSha, candidate, fixture, headSha, trusted };
}

function classifyFixture(mutate, exactPolicyOutcome = "success") {
  const fixture = classificationFixture(mutate);
  try {
    return classifyCandidate({
      baseSha: fixture.baseSha,
      candidateRoot: fixture.candidate,
      exactPolicyOutcome,
      headSha: fixture.headSha,
      trustedRoot: fixture.trusted,
    });
  } finally {
    rmSync(fixture.fixture, { force: true, recursive: true });
  }
}

test("trusted gate is callable only through a trusted target wrapper", () => {
  assert.match(workflow, /^on:\n  workflow_call:\n    inputs:\n      control_sha:/mu);
  assert.match(workflow, /required: true/u);
  assert.match(workflow, /type: string/u);
  assert.doesNotMatch(workflow, /^  pull_request(?:_target)?:/mu);
  assert.doesNotMatch(workflow, /^concurrency:/mu);
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(workflow, /openboa-ai\/coffee-chat-bench/gu);
  assert.doesNotMatch(workflow, /github\.repository != ''/u);
});

test("candidate is data and all controls come from immutable trusted commits", () => {
  const sourceCheckout = workflow.indexOf("ref: ${{ inputs.control_sha }}");
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
  assert.match(workflow, /ref: \$\{\{ inputs\.control_sha \}\}/gu);
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
    "Evaluate exact trusted base policy against candidate data",
  );
  assert.ok(rejection > 0);
  assert.ok(rejection < secretScan);
  assert.ok(rejection < policy);
});

test("authority check rejects every alternate npm authority", () => {
  for (const authority of [
    ".npmrc",
    ".github/policy-parser/.npmrc",
    "npm-shrinkwrap.json",
  ]) {
    const fixture = mkdtempSync(join(tmpdir(), "coffee-npm-authority-"));
    try {
      execFileSync("git", ["init", "-q", fixture]);
      mkdirSync(resolve(fixture, authority, ".."), { recursive: true });
      writeFileSync(resolve(fixture, authority), "registry=https://attacker.invalid\n");
      execFileSync("git", ["-C", fixture, "add", "."]);
      const result = spawnSync(authorityCheck, [fixture], { encoding: "utf8" });
      assert.equal(result.status, 1, `${authority} was accepted`);
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  }
});

test("classifier keeps routine changes automatic", () => {
  const result = classifyFixture((candidate) => {
    writeFileSync(join(candidate, "README.md"), "routine\n");
  });
  assert.equal(result.sensitive, false);
  assert.deepEqual(result.protectedChanges, []);
});

test("classifier routes protected edits and policy evolution to the Environment", () => {
  const protectedEdit = classifyFixture((candidate) => {
    writeFileSync(join(candidate, "src/control.ts"), "export const control = false;\n");
  });
  assert.equal(protectedEdit.sensitive, true);
  assert.deepEqual(protectedEdit.protectedChanges, ["src/control.ts"]);

  const policyEvolution = classifyFixture((candidate) => {
    writeFileSync(join(candidate, "README.md"), "new policy shape\n");
  }, "failure");
  assert.equal(policyEvolution.sensitive, true);
});

test("classifier checks both sides of protected path renames", () => {
  const result = classifyFixture((candidate) => {
    mkdirSync(join(candidate, "lib"));
    renameSync(join(candidate, "src/control.ts"), join(candidate, "lib/control.ts"));
  });
  assert.equal(result.sensitive, true);
  assert.ok(result.protectedChanges.includes("src/control.ts"));
});

test("classifier rejects any workflow except the exact inert trusted wrapper", () => {
  const fixture = classificationFixture((candidate) => {
    writeFileSync(join(candidate, ".github/workflows/spoof.yml"), "on: pull_request\n");
  });
  try {
    assert.throws(
      () =>
        classifyCandidate({
          baseSha: fixture.baseSha,
          candidateRoot: fixture.candidate,
          exactPolicyOutcome: "success",
          headSha: fixture.headSha,
          trustedRoot: fixture.trusted,
        }),
      /exact trusted wrapper/u,
    );
  } finally {
    rmSync(fixture.fixture, { force: true, recursive: true });
  }
});

test("trusted wrapper validation is version-updatable but structurally exact", () => {
  const firstSha = "a".repeat(40);
  const secondSha = "b".repeat(40);
  assert.equal(validateCandidateWorkflowDelegation(trustedWrapper(firstSha)), firstSha);
  assert.equal(validateCandidateWorkflowDelegation(trustedWrapper(secondSha)), secondSha);
  assert.throws(
    () =>
      validateCandidateWorkflowDelegation(
        trustedWrapper(firstSha).replace(
          `control_sha: ${firstSha}`,
          `control_sha: ${secondSha}`,
        ),
      ),
    /exact trusted wrapper/u,
  );
  assert.throws(
    () =>
      validateCandidateWorkflowDelegation(
        `${trustedWrapper(firstSha)}      - run: candidate-script\n`,
      ),
    /exact trusted wrapper/u,
  );
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
  assert.match(workflow, /trusted-npm-globalconfig/u);
  assert.match(workflow, /trusted-npm-userconfig/u);
  assert.doesNotMatch(
    workflow,
    /NPM_CONFIG_(?:GLOBAL|USER)CONFIG: \/dev\/null/u,
  );
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
  assert.match(
    workflow,
    /run: bash control\/\.github\/scripts\/install-gitleaks\.sh/u,
  );
  assert.match(workflow, /gitleaks git/u);
  assert.match(workflow, /git -C candidate cat-file blob/u);
  assert.match(
    workflow,
    /actions\/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294/u,
  );
  assert.match(workflow, /build-mode: none/u);
  assert.match(workflow, /security-events: write/u);
  assert.match(workflow, /needs: authorize/gu);
  assert.doesNotMatch(workflow, /^  pull_request_target:/mu);
});

test("exact policy failures and protected changes cannot bypass sensitive review", () => {
  assert.match(workflow, /id: exact-policy\n\s+continue-on-error: true/u);
  assert.match(workflow, /id: classify/u);
  assert.match(workflow, /EXACT_POLICY_OUTCOME: \$\{\{ steps\.exact-policy\.outcome \}\}/u);
  assert.match(workflow, /environment: coffee-security/u);
  assert.match(workflow, /needs\.authorize\.outputs\.sensitive == 'true'/u);
  assert.match(workflow, /SENSITIVE_REVIEW_RESULT/u);
  assert.match(workflow, /test "\$SENSITIVE_REVIEW_RESULT" = success/u);
  assert.match(workflow, /test "\$SENSITIVE_REVIEW_RESULT" = skipped/u);
});

test("trusted quality runs after authorization with fixed npm authority", () => {
  const classifier = workflow.indexOf("Classify policy evolution and protected path changes");
  const quality = workflow.indexOf("Trusted deterministic quality");
  assert.ok(classifier > 0);
  assert.ok(quality > classifier);
  assert.match(workflow, /needs\.sensitive-review\.result == 'success'/u);
  assert.match(qualityRunner, /^set -euo pipefail$/mu);
  assert.match(qualityRunner, /env -i/u);
  assert.match(qualityRunner, /npm_userconfig="\$candidate_tmp\/npm-userconfig"/u);
  assert.match(qualityRunner, /npm_globalconfig="\$candidate_tmp\/npm-globalconfig"/u);
  assert.match(qualityRunner, /NPM_CONFIG_USERCONFIG=\$npm_userconfig/u);
  assert.match(qualityRunner, /NPM_CONFIG_GLOBALCONFIG=\$npm_globalconfig/u);
  assert.match(qualityRunner, /: > "\$npm_userconfig"/u);
  assert.match(qualityRunner, /: > "\$npm_globalconfig"/u);
  assert.match(qualityRunner, /NPM_CONFIG_REPLACE_REGISTRY_HOST=never/u);
  assert.doesNotMatch(qualityRunner, /GITHUB_TOKEN|GH_TOKEN|ACTIONS_ID_TOKEN/u);
});

test("Eval Harbor calibration uses a fresh runner before any candidate program", () => {
  assert.doesNotMatch(qualityRunner, /harbor-requirements|canary:calibrate|benchmark:calibrate/u);
  assert.match(workflow, /eval-harbor:/u);
  assert.match(workflow, /github\.repository == 'openboa-ai\/coffee-chat-eval'/u);
  assert.match(workflow, /Trusted Eval Harbor calibration/u);
  const harborJob = workflow.slice(
    workflow.indexOf("  eval-harbor:"),
    workflow.lastIndexOf("  required:"),
  );
  assert.match(harborJob, /control\/\.github\/scripts\/run-eval-harbor\.sh/u);
  assert.doesNotMatch(harborJob, /npm run|npm test|src\/cli\.ts|src\/pcda-cli\.ts/u);
  assert.match(evalHarborRunner, /--require-hashes/u);
  assert.match(evalHarborRunner, /HARBOR_COMMAND=/u);
  assert.match(evalHarborRunner, /node --experimental-strip-types src\/canary-cli\.ts calibrate/u);
  assert.match(evalHarborRunner, /node --experimental-strip-types src\/canary-cli\.ts benchmark-calibrate/u);
  assert.doesNotMatch(evalHarborRunner, /npm run|npm test|src\/cli\.ts|src\/pcda-cli\.ts/u);
  assert.match(workflow, /EVAL_HARBOR_RESULT/u);
});
