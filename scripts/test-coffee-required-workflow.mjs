import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { checkCodeqlSarif } from "../.github/scripts/check-codeql-sarif.mjs";

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

function writeEmpty(path) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, "");
}

function zeroBaseBenchFixture(layout) {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-zero-base-bench-"));
  const candidate = join(fixture, "candidate");
  const bin = join(fixture, "bin");
  const runnerTemp = join(fixture, "runner-temp");
  mkdirSync(candidate);
  mkdirSync(bin);
  mkdirSync(runnerTemp);
  const npm = join(bin, "npm");
  writeFileSync(npm, "#!/bin/sh\nexit 0\n");
  chmodSync(npm, 0o755);
  for (const path of [
    "evals/README.md",
    "graders/README.md",
    "research/README.md",
  ]) {
    writeEmpty(join(candidate, path));
  }

  if (layout === "legacy" || layout === "legacy-hybrid") {
    for (const path of [
      "evals/output-quality/perspective-capture/.gitkeep",
      "evals/output-quality/perspective-application/human-understanding/.gitkeep",
      "evals/output-quality/perspective-application/agent-judgment-action/.gitkeep",
      "evals/triggering/perspective-capture/.gitkeep",
      "evals/triggering/perspective-application/.gitkeep",
    ]) {
      writeEmpty(join(candidate, path));
    }
    if (layout === "legacy-hybrid") {
      mkdirSync(
        join(candidate, "evals/output-quality/preference-inference/development"),
        { recursive: true },
      );
    }
  } else {
    writeEmpty(join(candidate, "PREREGISTRATION.md"));
    for (const task of [
      "preference-inference",
      "personalized-response-generation",
      "personalized-task-execution",
    ]) {
      mkdirSync(join(candidate, "evals/output-quality", task, "development"), {
        recursive: true,
      });
      mkdirSync(join(candidate, "evals/output-quality", task, "validation"), {
        recursive: true,
      });
    }
    mkdirSync(join(candidate, "evals/skill-triggering/development"), {
      recursive: true,
    });
    mkdirSync(join(candidate, "evals/skill-triggering/validation"), {
      recursive: true,
    });
    if (layout === "active") {
      mkdirSync(
        join(
          candidate,
          "evals/output-quality/preference-inference/development/pi-0001",
        ),
      );
    }
    if (layout === "hybrid") {
      writeEmpty(
        join(candidate, "evals/output-quality/perspective-capture/.gitkeep"),
      );
    }
    if (layout === "incomplete") {
      rmSync(
        join(
          candidate,
          "evals/output-quality/personalized-task-execution/validation",
        ),
        { recursive: true },
      );
    }
    if (layout === "missing-common") {
      rmSync(join(candidate, "evals/README.md"));
    }
  }

  return { bin, candidate, fixture, runnerTemp };
}

function runZeroBaseBenchFixture(layout) {
  const fixture = zeroBaseBenchFixture(layout);
  try {
    return spawnSync(
      qualityRunnerPath,
      ["openboa-ai/coffee-chat-bench", fixture.candidate],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: fixture.fixture,
          PATH: `${fixture.bin}:${process.env.PATH}`,
          RUNNER_TEMP: fixture.runnerTemp,
        },
      },
    );
  } finally {
    rmSync(fixture.fixture, { force: true, recursive: true });
  }
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
  writeFileSync(
    join(candidate, "package.json"),
    `${JSON.stringify({ devDependencies: { prettier: "3.9.6" } })}\n`,
  );
  writeFileSync(
    join(candidate, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3 })}\n`,
  );
  writeFileSync(join(candidate, "src/control.ts"), "export const control = true;\n");
  writeFileSync(
    join(candidate, ".github/workflows/trusted.yml"),
    trustedWrapper("a".repeat(40)),
  );
  const baseSha = commit(candidate, "base");
  writeFileSync(
    join(trusted, ".github/merge-policy.json"),
    `${JSON.stringify({
      protected_paths: [
        "/src/**",
        "/.github/**",
        "/package.json",
        "/package-lock.json",
      ],
    })}\n`,
  );
  mutate(candidate);
  const headSha = commit(candidate, "candidate");
  return { baseSha, candidate, fixture, headSha, trusted };
}

function classifyFixture(
  mutate,
  exactPolicyOutcome = "success",
  identity = {
    actor: "solo-maintainer",
    baseRepository: "openboa-ai/coffee-chat",
    headRepository: "openboa-ai/coffee-chat",
    prAuthor: "solo-maintainer",
  },
) {
  const fixture = classificationFixture(mutate);
  try {
    return classifyCandidate({
      ...identity,
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

test("classifier exempts only exact in-repository Dependabot package changes", () => {
  const packageChanges = (candidate) => {
    writeFileSync(
      join(candidate, "package.json"),
      `${JSON.stringify({ devDependencies: { prettier: "3.9.7" } })}\n`,
    );
    writeFileSync(
      join(candidate, "package-lock.json"),
      `${JSON.stringify({ lockfileVersion: 3, updated: true })}\n`,
    );
  };
  const dependabotIdentity = {
    actor: "dependabot[bot]",
    baseRepository: "openboa-ai/coffee-chat",
    headRepository: "openboa-ai/coffee-chat",
    prAuthor: "dependabot[bot]",
  };

  const routine = classifyFixture(
    packageChanges,
    "success",
    dependabotIdentity,
  );
  assert.equal(routine.sensitive, false);
  assert.deepEqual(routine.protectedChanges, [
    "package-lock.json",
    "package.json",
  ]);

  for (const [
    label,
    exactPolicyOutcome,
    identity,
    mutate,
    expectedProtectedChanges,
  ] of [
    [
      "owner package update",
      "success",
      {
        actor: "solo-maintainer",
        baseRepository: "openboa-ai/coffee-chat",
        headRepository: "openboa-ai/coffee-chat",
        prAuthor: "solo-maintainer",
      },
      packageChanges,
      ["package-lock.json", "package.json"],
    ],
    [
      "Dependabot actor mismatch",
      "success",
      { ...dependabotIdentity, actor: "solo-maintainer" },
      packageChanges,
      ["package-lock.json", "package.json"],
    ],
    [
      "Dependabot author mismatch",
      "success",
      { ...dependabotIdentity, prAuthor: "solo-maintainer" },
      packageChanges,
      ["package-lock.json", "package.json"],
    ],
    [
      "Dependabot fork",
      "success",
      { ...dependabotIdentity, headRepository: "attacker/coffee-chat" },
      packageChanges,
      ["package-lock.json", "package.json"],
    ],
    [
      "policy failure",
      "failure",
      dependabotIdentity,
      packageChanges,
      ["package-lock.json", "package.json"],
    ],
    [
      "additional protected path",
      "success",
      dependabotIdentity,
      (candidate) => {
        packageChanges(candidate);
        writeFileSync(
          join(candidate, "src/control.ts"),
          "export const control = false;\n",
        );
      },
      ["package-lock.json", "package.json", "src/control.ts"],
    ],
  ]) {
    const result = classifyFixture(mutate, exactPolicyOutcome, identity);
    assert.equal(result.sensitive, true, label);
    assert.deepEqual(
      result.protectedChanges,
      expectedProtectedChanges,
      label,
    );
  }
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

test("authority check rejects candidate gitlinks", () => {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-authority-gitlink-"));
  try {
    execFileSync("git", ["init", "-q", fixture]);
    execFileSync("git", ["-C", fixture, "config", "user.email", "test@example.invalid"]);
    execFileSync("git", ["-C", fixture, "config", "user.name", "Policy test"]);
    writeFileSync(join(fixture, "README.md"), "fixture\n");
    const commitSha = commit(fixture, "fixture");
    execFileSync("git", [
      "-C",
      fixture,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${commitSha},evals/output-quality/preference-inference/development`,
    ]);
    const result = spawnSync(authorityCheck, [fixture], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /candidate gitlinks are not allowed/u);
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
    /npm ci --ignore-scripts --no-bin-links --prefix "\$GITHUB_WORKSPACE\/trusted-target\/\.github\/policy-parser"/u,
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

test("trusted gate uses a strict scan when the candidate removes the base ignore file", () => {
  assert.match(
    workflow,
    /if test -e trusted-target\/\.gitleaksignore; then\n\s+if test -e candidate\/\.gitleaksignore; then\n\s+cmp trusted-target\/\.gitleaksignore candidate\/\.gitleaksignore\n\s+ignore_path="\$GITHUB_WORKSPACE\/trusted-target\/\.gitleaksignore"\n\s+fi\n\s+history_ignore_path="\$GITHUB_WORKSPACE\/trusted-target\/\.gitleaksignore"\n\s+else\n\s+test ! -e candidate\/\.gitleaksignore/u,
  );
  assert.match(workflow, /ignore_path=\/dev\/null/u);
  assert.match(workflow, /history_ignore_path="\$GITHUB_WORKSPACE\/trusted-target\/\.gitleaksignore"/u);
  assert.match(
    workflow,
    /gitleaks git --config "\$GITLEAKS_TRUSTED_CONFIG" \\\n\s+--gitleaks-ignore-path "\$history_ignore_path"/u,
  );
});

test("trusted CodeQL fails closed on local SARIF findings", () => {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-codeql-sarif-"));
  try {
    const sarifPath = join(fixture, "javascript.sarif");
    writeFileSync(
      sarifPath,
      `${JSON.stringify({
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }],
      })}\n`,
    );
    assert.deepEqual(checkCodeqlSarif(fixture), { files: 1, results: 0 });

    writeFileSync(
      sarifPath,
      `${JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "CodeQL" } },
            results: [{ ruleId: "js/example" }],
          },
        ],
      })}\n`,
    );
    assert.throws(() => checkCodeqlSarif(fixture), /CodeQL findings/u);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("trusted CodeQL requires regular bounded SARIF output", () => {
  const fixture = mkdtempSync(join(tmpdir(), "coffee-codeql-bounds-"));
  try {
    assert.throws(() => checkCodeqlSarif(fixture), /SARIF file/u);
    const outside = join(fixture, "outside.json");
    writeFileSync(outside, '{"version":"2.1.0","runs":[]}\n');
    symlinkSync(outside, join(fixture, "javascript.sarif"));
    assert.throws(() => checkCodeqlSarif(fixture), /regular file/u);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});

test("trusted CodeQL checks generated SARIF before aggregate success", () => {
  const codeqlJob = workflow.slice(
    workflow.indexOf("  codeql:"),
    workflow.indexOf("  quality:"),
  );
  const controlCheckout = codeqlJob.indexOf(
    "repository: openboa-ai/.github",
  );
  const candidateCheckout = codeqlJob.indexOf(
    "repository: ${{ github.event.pull_request.head.repo.full_name }}",
  );
  const analyze = codeqlJob.indexOf("id: codeql-analyze");
  const sarifCheck = codeqlJob.indexOf(
    "node control/.github/scripts/check-codeql-sarif.mjs",
  );
  assert.ok(controlCheckout > 0);
  assert.ok(candidateCheckout > controlCheckout);
  assert.ok(analyze > 0);
  assert.ok(sarifCheck > analyze);
  assert.match(codeqlJob, /ref: \$\{\{ inputs\.control_sha \}\}/u);
  assert.match(codeqlJob, /path: control/u);
  assert.match(codeqlJob, /path: candidate/u);
  assert.match(codeqlJob, /source-root: candidate/u);
  assert.match(
    codeqlJob,
    /checkout_path: \$\{\{ github\.workspace \}\}\/candidate/u,
  );
  assert.match(codeqlJob, /output: \$\{\{ runner\.temp \}\}\/codeql-sarif/u);
  assert.match(codeqlJob, /steps\.codeql-analyze\.outputs\.sarif-output/u);
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
  const classifyStep = workflow.slice(
    workflow.indexOf("      - name: Classify policy evolution"),
    workflow.indexOf("\n\n  sensitive-review:"),
  );
  assert.match(classifyStep, /ACTOR: \$\{\{ github\.actor \}\}/u);
  assert.match(classifyStep, /BASE_REPOSITORY: \$\{\{ github\.repository \}\}/u);
  assert.match(
    classifyStep,
    /HEAD_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/u,
  );
  assert.match(
    classifyStep,
    /PR_AUTHOR: \$\{\{ github\.event\.pull_request\.user\.login \}\}/u,
  );
});

test("trusted quality runs after authorization with fixed npm authority", () => {
  const classifier = workflow.indexOf("Classify policy evolution and protected path changes");
  const quality = workflow.indexOf("Trusted deterministic quality");
  const qualityJob = workflow.slice(
    workflow.indexOf("  quality:"),
    workflow.indexOf("  eval-harbor:"),
  );
  const gitleaksInstall = qualityJob.indexOf(
    "bash control/.github/scripts/install-gitleaks.sh",
  );
  const candidateQuality = qualityJob.indexOf(
    "control/.github/scripts/run-candidate-quality.sh",
  );
  assert.ok(classifier > 0);
  assert.ok(quality > classifier);
  assert.ok(gitleaksInstall > 0);
  assert.ok(candidateQuality > gitleaksInstall);
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
  assert.match(qualityRunner, /run_clean npm ci --ignore-scripts --no-bin-links\n/u);
  assert.match(
    qualityRunner,
    /run_clean npm ci --ignore-scripts --no-bin-links --prefix \.github\/policy-parser/u,
  );
  assert.match(qualityRunner, /zero_base_layout\(\)/u);
  assert.match(
    qualityRunner,
    /evals\/output-quality\/perspective-capture\/\.gitkeep/u,
  );
  for (const path of [
    "PREREGISTRATION.md",
    "preference-inference",
    "personalized-response-generation",
    "personalized-task-execution",
    'evals/output-quality/$task/development',
    'evals/output-quality/$task/validation',
    "evals/skill-triggering/development",
    "evals/skill-triggering/validation",
  ]) {
    assert.ok(qualityRunner.includes(path), path);
  }
  assert.doesNotMatch(qualityRunner, /run_clean node \.github\/ci-policy\.mjs/u);
  assert.match(
    qualityRunner,
    /candidate is neither a legacy Coffee repository nor a recognized zero-base layout/u,
  );

  const commandsByRepository = new Map([
    [
      "openboa-ai/coffee-chat",
      [
        "run_clean node node_modules/prettier/bin/prettier.cjs --check .",
        "run_clean node node_modules/typescript/bin/tsc --noEmit",
        "run_clean node --test tests/*.test.mjs",
        "run_clean node scripts/verify-readme-assets.mjs",
        "run_clean node scripts/build-package.mjs",
        "run_clean node scripts/package-smoke.mjs",
      ],
    ],
    [
      "openboa-ai/coffee-chat-roastery",
      [
        "run_clean node node_modules/prettier/bin/prettier.cjs --check .",
        "run_clean node node_modules/typescript/bin/tsc --noEmit",
        "run_clean node scripts/build.mjs",
        "run_clean git diff --exit-code -- dist",
        "run_clean node scripts/check-repository-state.mjs --root .",
        "run_clean node --test tests/*.test.mjs",
        "run_clean node scripts/check-package.mjs",
      ],
    ],
    [
      "openboa-ai/coffee-chat-eval",
      [
        "run_clean node node_modules/prettier/bin/prettier.cjs --check .",
        "run_clean node node_modules/typescript/bin/tsc --noEmit",
        "run_clean npm test",
        "run_clean npm run dry-run",
        "run_clean npm run smoke",
        "run_clean npm run ci:policy",
      ],
    ],
    [
      "openboa-ai/coffee-chat-bench",
      [
        'run_clean node node_modules/prettier/bin/prettier.cjs --check AGENTS.md README.md DATA-CARD.md PREREGISTRATION.md OVERLAP-REPORT.json package.json package-lock.json tsconfig.json prettier.config.mjs docs/*.md docs/validity/*.md harbor/*.md qualification/*.md qualification/*.json "bank/**/*.json" harbor/*.ts schemas/*.json scripts/*.mjs src/*.ts tests/*.mjs tests/*.ts',
        "run_clean node scripts/check-inactive-boundary.mjs --root .",
        "run_clean node node_modules/typescript/bin/tsc --noEmit",
        "run_clean node --experimental-strip-types --test tests/*.test.mjs tests/*.test.ts",
      ],
    ],
  ]);

  for (const [repository, commands] of commandsByRepository) {
    const repositoryCase = qualityRunner.lastIndexOf('case "$repository" in');
    const start = qualityRunner.indexOf(`  ${repository})`, repositoryCase);
    const end = qualityRunner.indexOf("    ;;", start);
    assert.ok(start > 0, `${repository}: command branch`);
    assert.ok(end > start, `${repository}: command branch end`);
    const branch = qualityRunner.slice(start, end);
    const commandLines = branch
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("run_clean "));
    assert.deepEqual(commandLines, commands, repository);
  }
});

test("trusted zero-base recognition accepts legacy and current Bench layouts", () => {
  for (const layout of ["legacy", "current", "active"]) {
    const result = runZeroBaseBenchFixture(layout);
    assert.equal(result.status, 0, `${layout}: ${result.stderr}`);
  }
});

test("trusted zero-base recognition rejects incomplete and hybrid Bench layouts", () => {
  for (const layout of [
    "incomplete",
    "hybrid",
    "legacy-hybrid",
    "missing-common",
  ]) {
    const result = runZeroBaseBenchFixture(layout);
    assert.equal(result.status, 1, `${layout}: ${result.stderr}`);
    assert.match(result.stderr, /recognized zero-base layout/u);
  }
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
  assert.match(evalHarborRunner, /--harbor-command/u);
  assert.match(evalHarborRunner, /node --experimental-strip-types src\/cli\.ts oracle-control/u);
  assert.match(evalHarborRunner, /candidate_root.*iterations\/README\.md/u);
  assert.match(evalHarborRunner, /Eval Harbor calibration not applicable/u);
  assert.match(workflow, /EVAL_HARBOR_RESULT/u);
});
