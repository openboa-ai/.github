import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { classifyCandidate, trustedWrapper, validateCandidateWorkflowDelegation } from "../.github/scripts/classify-candidate.mjs";
import { validateCandidatePolicy, validatePackage } from "../.github/scripts/check-candidate-policy.mjs";
import { checkCodeqlSarif } from "../.github/scripts/check-codeql-sarif.mjs";
import { checkRequiredResults } from "../.github/scripts/check-required-results.mjs";
import { containerArgs, IMAGE } from "../.github/scripts/run-repository-verify.mjs";
import { auditSettings } from "../.github/scripts/audit-ci-settings.mjs";

const source = resolve(import.meta.dirname, "..");
const workflow = readFileSync(join(source, ".github/workflows/coffee-trusted-gate.yml"), "utf8");
const write = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const json = (root, path, data) => write(root, path, JSON.stringify(data, null, 2) + "\n");
const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
function commit(root) {
  git(root, "add", "-f", "--all");
  git(root, "-c", "user.name=CI test", "-c", "user.email=ci@example.invalid", "commit", "-qm", "fixture");
  return git(root, "rev-parse", "HEAD").trim();
}
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "coffee-ci-policy-"));
  const base = join(root, "base"), candidate = join(root, "candidate");
  try {
    const policy = {
      merge_method: "squash", merge_queue: false, required_approvals: 0,
      eligible_author_associations: ["OWNER", "MEMBER"], eligible_bot_logins: ["dependabot[bot]"],
      required_checks: [{ context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required", integration_id: 15368 }],
      protected_paths: ["/.github/**", "/AGENTS.md", "/CODEOWNERS", "/package.json", "/package-lock.json", "/data/**"],
      sensitive_review: { enforcement: "github_environment", environment: "coffee-security", required_approvals: 1, prevent_self_review: false },
    };
    json(base, ".github/merge-policy.json", policy);
    json(base, "package.json", { name: "fixture", version: "0.0.0", private: true, scripts: { verify: "node verify.mjs" } });
    json(base, "package-lock.json", { name: "fixture", version: "0.0.0", lockfileVersion: 3, packages: { "": { name: "fixture", version: "0.0.0" } } });
    write(base, ".github/workflows/trusted.yml", trustedWrapper("a".repeat(40)));
    write(base, ".github/dependabot.yml", "version: 2\nupdates: []\n");
    write(base, ".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
    execFileSync("chmod", ["755", join(base, ".githooks/pre-commit")]);
    write(base, "CODEOWNERS", "/.github/** @owner\n");
    write(base, "AGENTS.md", "Keep the trust boundary.\n");
    write(base, "SECURITY.md", "Private vulnerability reporting.\n");
    write(base, ".gitignore", ".env\nnode_modules/\n");
    write(base, "README.md", "fixture\n");
    write(base, "verify.mjs", "throw Error('candidate code must never run in policy checks');\n");
    cpSync(base, candidate, { recursive: true });
    git(candidate, "init", "-q");
    return run({ root, base, candidate, baseSha: commit(candidate), policy });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("policy reads data without executing candidate or requiring a base parser", () => fixture(({ base, candidate }) => {
  assert.deepEqual(validateCandidatePolicy(base, candidate), { status: "policy-passed" });
}));
test("old and post-merge wrappers are structurally exact and SHA-updatable", () => {
  for (const sha of ["a".repeat(40), "b".repeat(40)]) for (const push of [false, true]) assert.equal(validateCandidateWorkflowDelegation(trustedWrapper(sha, push)), sha);
  for (const mutate of [
    (s) => s.replace("contents: read", "contents: write"),
    (s) => s.replace("control_sha: " + "a".repeat(40), "control_sha: " + "b".repeat(40)),
    (s) => s + "    steps:\n      - run: echo spoof\n",
    (s) => s.replace("pull_request_target:", "pull_request:"),
  ]) assert.throws(() => validateCandidateWorkflowDelegation(mutate(trustedWrapper("a".repeat(40)))));
  assert.match(trustedWrapper("a".repeat(40), true), /push:\n    branches: \[main\]/u);
});
test("invalid policy and removed safeguards fail rather than request approval", () => {
  for (const mutate of [
    ({ candidate, policy }) => { policy.protected_paths.pop(); json(candidate, ".github/merge-policy.json", policy); },
    ({ candidate, policy }) => { policy.required_checks = []; json(candidate, ".github/merge-policy.json", policy); },
    ({ candidate, policy }) => { policy.sensitive_review.required_approvals = 0; json(candidate, ".github/merge-policy.json", policy); },
    ({ candidate }) => write(candidate, ".github/workflows/spoof.yml", "on: pull_request\n"),
    ({ candidate }) => write(candidate, ".githooks/pre-commit", "disabled\n"),
    ({ candidate }) => write(candidate, ".gitignore", "node_modules/\n"),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @other\n"),
    ({ candidate }) => write(candidate, ".github/merge-policy.json", "{malformed"),
  ]) fixture((f) => { mutate(f); git(f.candidate, "add", "-f", "--all"); assert.throws(() => validateCandidatePolicy(f.base, f.candidate)); });
});
test("alternate authority, symlinks and gitlinks cannot cross the boundary", () => {
  for (const path of [".npmrc", "npm-shrinkwrap.json", "nested/.npmrc", ".gitleaks.toml"]) fixture(({ base, candidate }) => {
    write(candidate, path, "untrusted\n"); git(candidate, "add", "-f", "--all"); assert.throws(() => validateCandidatePolicy(base, candidate));
  });
  fixture(({ base, candidate }) => {
    symlinkSync("package.json", join(candidate, "escape")); git(candidate, "add", "--all"); assert.throws(() => validateCandidatePolicy(base, candidate));
  });
  fixture(({ base, candidate, baseSha }) => {
    git(candidate, "update-index", "--add", "--cacheinfo", "160000," + baseSha + ",external"); assert.throws(() => validateCandidatePolicy(base, candidate));
  });
});
test("lock rejects local dependencies, missing integrity, implicit scripts and drift", () => {
  for (const mutate of [
    (pkg) => { pkg.private = false; },
    (pkg) => { pkg.scripts.preverify = "node malicious.mjs"; },
    (pkg, lock) => { lock.name = "other"; },
    (pkg, lock) => { lock.packages["node_modules/dep"] = { resolved: "file:../private", integrity: "sha512-YWJj" }; },
    (pkg, lock) => { lock.packages["node_modules/dep"] = { resolved: "https://registry.npmjs.org/dep/-/dep-1.0.0.tgz" }; },
  ]) fixture(({ candidate }) => {
    const pkg = JSON.parse(readFileSync(join(candidate, "package.json")));
    const lock = JSON.parse(readFileSync(join(candidate, "package-lock.json")));
    mutate(pkg, lock); json(candidate, "package.json", pkg); json(candidate, "package-lock.json", lock); assert.throws(() => validatePackage(candidate));
  });
});
test("classification uses protected paths, not product formats or parser errors", () => {
  for (const [path, sensitive] of [["README.md", false], ["data/new-format.json", true], [".gitignore", true]]) fixture(({ base, candidate, baseSha }) => {
    write(candidate, path, "new data\n"); const headSha = commit(candidate);
    assert.equal(classifyCandidate({ baseRepository: "openboa-ai/coffee-chat-bench", headRepository: "openboa-ai/coffee-chat-bench", actor: "owner", prAuthor: "owner", trustedRoot: base, candidateRoot: candidate, baseSha, headSha }).sensitive, sensitive);
  });
});
test("Dependabot cannot change verify while posing as a package update", () => fixture(({ base, candidate, baseSha }) => {
  const pkg = JSON.parse(readFileSync(join(candidate, "package.json")));
  pkg.scripts.verify = "echo bypass"; json(candidate, "package.json", pkg);
  const headSha = commit(candidate);
  assert.equal(classifyCandidate({ baseRepository: "openboa-ai/coffee-chat", headRepository: "openboa-ai/coffee-chat", actor: "dependabot[bot]", prAuthor: "dependabot[bot]", trustedRoot: base, candidateRoot: candidate, baseSha, headSha }).sensitive, true);
}));
test("aggregate rejects missing, cancelled, failed and unapproved runs", () => {
  const success = () => ({ authorize: { result: "success", outputs: { sensitive: "false" } }, "dependency-review": { result: "success" }, codeql: { result: "success" }, quality: { result: "success" }, "sensitive-review": { result: "skipped" } });
  assert.equal(checkRequiredResults(success()).status, "required-checks-passed");
  for (const job of ["authorize", "dependency-review", "codeql", "quality"]) for (const state of ["failure", "cancelled", "skipped", undefined]) {
    const result = success(); result[job].result = state; assert.throws(() => checkRequiredResults(result));
  }
  for (const state of ["failure", "cancelled", "skipped", undefined]) {
    const result = success(); result.authorize.outputs.sensitive = "true"; result["sensitive-review"].result = state; assert.throws(() => checkRequiredResults(result));
  }
  const result = success(); result.authorize.outputs.sensitive = "true"; result["sensitive-review"].result = "success"; assert.equal(checkRequiredResults(result).status, "required-checks-passed");
  delete result.authorize.outputs.sensitive; assert.throws(() => checkRequiredResults(result));
});
test("sandbox has no verification network, host bind, socket or inherited credentials", () => {
  const args = containerArgs("coffee-test", "none", "cd repo; npm --ignore-scripts run verify");
  for (const flag of ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit=256"]) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--user") + 1], "1000:1000");
  assert.equal(args[args.indexOf("--mount") + 1], "type=volume,source=coffee-test,target=/work");
  assert.equal(args.filter((arg) => arg === "--mount").length, 1);
  assert.match(IMAGE, /^node@sha256:[0-9a-f]{64}$/u);
  assert.doesNotMatch(args.join(" "), /docker\.sock|type=bind|GITHUB_TOKEN|GITHUB_OUTPUT|--privileged|--env-file/u);
});
test("workflow preserves trusted scans and approval ordering without product coupling", () => {
  for (const pattern of [/gitleaks git/u, /git -C candidate cat-file blob/u, /dependency-review-action@[0-9a-f]{40}/u, /build-mode: none/u, /check-codeql-sarif.mjs/u, /environment: coffee-security/u, /needs\.sensitive-review\.result == 'success'/u, /run-repository-verify.mjs/u]) assert.match(workflow, pattern);
  assert.doesNotMatch(workflow, /continue-on-error|exact-policy|policy-bootstrap|ci-policy.mjs|run-candidate-quality|harbor/u);
  for (const match of workflow.matchAll(/uses: ([^\s]+)/gu)) assert.match(match[1], /@[0-9a-f]{40}$/u);
  assert.doesNotMatch(readFileSync(join(source, ".github/scripts/check-candidate-policy.mjs"), "utf8"), /skills\/|evals\/|iterations\/|perspective-capture|development\/|policy-parser/u);
});
test("CodeQL findings and missing, malformed or symlinked SARIF fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-sarif-"));
  try {
    assert.throws(() => checkCodeqlSarif(root));
    const clean = { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }] };
    json(root, "javascript.sarif", clean); assert.deepEqual(checkCodeqlSarif(root), { files: 1, results: 0 });
    clean.runs[0].results = [{ message: { text: "finding" } }]; json(root, "javascript.sarif", clean); assert.throws(() => checkCodeqlSarif(root));
    write(root, "javascript.sarif", "{}"); assert.throws(() => checkCodeqlSarif(root));
    rmSync(join(root, "javascript.sarif")); symlinkSync("missing", join(root, "javascript.sarif")); assert.throws(() => checkCodeqlSarif(root));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("JavaScript and shell controls pass syntax checks", () => {
  for (const file of readdirSync(join(source, ".github/scripts"))) {
    const path = join(source, ".github/scripts", file);
    if (file.endsWith(".mjs")) assert.equal(spawnSync(process.execPath, ["--check", path]).status, 0, file);
    if (file.endsWith(".sh")) assert.equal(spawnSync("bash", ["-n", path]).status, 0, file);
  }
});

test("live settings audit distinguishes declarations from enforced reviews and checks", () => {
  const snapshot = {
    rulesets: [{ enforcement: "active", conditions: { ref_name: { include: ["refs/heads/main"] } }, bypass_actors: [], rules: [
      ...["deletion", "non_fast_forward", "required_linear_history"].map((type) => ({ type })),
      { type: "pull_request", parameters: { require_code_owner_review: true, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required", integration_id: 15368 }] } },
    ] }],
    environment: { protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "owner" } }] }] },
    actions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
  };
  assert.deepEqual(auditSettings("coffee-chat-bench", snapshot).issues, []);
  snapshot.environment.protection_rules = [];
  assert.ok(auditSettings("coffee-chat-bench", snapshot).issues.includes("coffee-security has no required reviewers."));
  snapshot.rulesets = [];
  assert.ok(auditSettings("coffee-chat-bench", snapshot).issues.includes("No active ruleset protects main."));
});

test("early symlink in a large index still fails the executable authority guard", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-index-"));
  try {
    git(root, "init", "-q");
    write(root, "package.json", "{}\n");
    symlinkSync("package.json", join(root, "000-escape"));
    for (let i = 0; i < 5000; i++) write(root, "bulk/" + i, "x");
    git(root, "add", "--all");
    assert.notEqual(spawnSync("bash", [join(source, ".github/scripts/reject-candidate-authorities.sh"), root]).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("actual admission step rejects forks and unsupported events before checkout", () => {
  const block = workflow.slice(workflow.indexOf("      - name: Admit only"), workflow.indexOf("      - name: Check out immutable"));
  const script = block.slice(block.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map((line) => line.slice(10)).join("\n");
  const env = { PATH: process.env.PATH, BASE_REPOSITORY: "openboa-ai/coffee-chat", HEAD_REPOSITORY: "openboa-ai/coffee-chat", EVENT_NAME: "pull_request_target", AUTHOR_ASSOCIATION: "OWNER", ACTOR: "owner", PR_AUTHOR: "owner", REF_NAME: "refs/heads/main" };
  for (const [change, succeeds] of [
    [{}, true],
    [{ HEAD_REPOSITORY: "outsider/coffee-chat" }, false],
    [{ AUTHOR_ASSOCIATION: "CONTRIBUTOR" }, false],
    [{ AUTHOR_ASSOCIATION: "CONTRIBUTOR", ACTOR: "dependabot[bot]", PR_AUTHOR: "dependabot[bot]" }, true],
    [{ EVENT_NAME: "push" }, true],
    [{ EVENT_NAME: "push", REF_NAME: "refs/heads/feature" }, false],
    [{ EVENT_NAME: "workflow_dispatch" }, false],
  ]) assert.equal(spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], { env: { ...env, ...change } }).status === 0, succeeds);
});
