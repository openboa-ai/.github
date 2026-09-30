import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateMergeEvidence } from "../lib/evaluate-merge-evidence.mjs";

const sha = (character) => character.repeat(40);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const principal = () => ({ kind: "current-request-credential", scope: "report-only-collector" });
const job = (role, name, steps) => ({ role, name, steps });
// Real public topology and step names; all identifiers/content of observations below are synthetic.
function fixture() {
  const languages = ["actions", "javascript-typescript", "python"];
  const policy = {
    version: 1, trustModel: "trusted-solo-writer", deploymentPlan: "free",
    repository: { id: 1214829403, fullName: "openboa-ai/openboa" }, controlSha: sha("c"), maxAgeMs: 60_000,
    runs: [
      { role: "ci", workflowId: 262978663, path: ".github/workflows/ci.yml", event: "pull_request", jobs: [
        job("scope", "scope", ["Record source receipt", "Upload source receipt", "Detect docs scope", "Compute scope flags"]),
        job("policy", "policy", ["Validate CI policy baseline"]),
        job("secrets", "secrets", ["Detect secrets baseline", "Detect private keys", "Lint GitHub Actions workflows", "Audit GitHub Actions workflows"]),
        job("gitleaks", "gitleaks", ["Run gitleaks"]),
        job("dependencies", "dependency-audit / audit", ["Validate frozen dependency graph without lifecycle scripts", "Audit all dependency scopes and severities"]),
        job("check", "check", ["Run checks"]),
        job("docs", "docs", ["Check docs", "Check docs links", "Validate Mintlify docs"]),
        job("desktop", "desktop-artifact", ["Build macOS desktop artifact"]),
        job("aggregate", "required-ci", ["Evaluate job results"]),
      ] },
      { role: "codeql", workflowId: 262978664, path: ".github/workflows/codeql.yml", event: "pull_request", jobs: languages.map((language) => job(language, `analyze (${language})`, ["Record source receipt", "Initialize CodeQL", "Perform CodeQL Analysis", "Prepare merge evidence", "Upload merge evidence"])) },
      { role: "convention", workflowId: 262978665, path: ".github/workflows/pr-convention.yml", event: "pull_request", jobs: [job("convention", "convention", ["Record source receipt", "Upload source receipt", "Validate PR title/body convention"])] },
    ],
    platformGate: { workflowId: 347609655, path: "dynamic/github-code-quality/codeql", event: "dynamic", appId: 15368, jobs: ["Analyze (python)", "Analyze (javascript-typescript)"] },
    requiredChecks: [{ context: "required-ci", appId: 15368 }, { context: "convention", appId: 15368 }],
    receiptCategories: { "javascript-typescript": ".github/workflows/codeql.yml:analyze", python: ".github/workflows/codeql.yml:analyze-python", actions: ".github/workflows/codeql.yml:analyze-actions" },
    sarifCategories: { "javascript-typescript": ".github/workflows/codeql.yml:analyze/", python: ".github/workflows/codeql.yml:analyze-python/", actions: ".github/workflows/codeql.yml:analyze-actions/" },
    codeqlVersion: "2.26.2", allowedDocumentationPaths: ["README.md", "docs/guide.md"], protectedPaths: ["docs/security-design.md"],
    controlClosure: [".github/workflows/ci.yml", ".github/workflows/codeql.yml", ".github/workflows/pr-convention.yml", ".github/workflows/dependency-audit.yml", "scripts/validate-ci-policy.mjs"].map((path) => ({ path, sha256: digest(`synthetic trusted bytes for ${path}`) })),
  };
  const snapshot = {
    version: 1, collection: { status: "completed", drift: false, errors: [], blockers: [], principal: principal() }, collectedAt: 1_800_000_000_000, evaluationTime: 1_800_000_000_001,
    selection: { status: "verified", pullRequestNumber: 5, baseSha: sha("a"), headSha: sha("b"), testedSha: sha("d"), platformGate: { id: 400, attempt: 1, latestAttempt: 1 }, runs: policy.runs.map(({ role }, index) => ({ role, id: 300 + index, attempt: 1, latestAttempt: 1 })) },
    repository: { ...policy.repository, visibility: "public", defaultBranchSha: sha("a") },
    pullRequest: { number: 5, state: "open", draft: false, baseSha: sha("a"), headSha: sha("b"), headRepositoryId: policy.repository.id, baseAncestorOfHead: true, changedFiles: 1, mergeable: true, mergeableState: "clean" },
    controlSha: sha("c"), scope: "allowlisted-documentation",
    rules: { complete: true, enforcement: "active", requirePullRequest: true, strictRequiredChecks: true, applicableRulesets: [{ id: 15257114, sourceType: "Repository", source: policy.repository.fullName }], currentPrincipalBypass: { status: "verified", principal: principal(), rulesets: [] }, requiredChecks: structuredClone(policy.requiredChecks), codeQuality: "errors", codeScanning: { tool: "CodeQL", securityThreshold: "high_or_higher", alertsThreshold: "errors" } },
    files: { complete: true, treeComplete: true, treesTruncated: false, totalCount: 1, pages: [{ number: 1, count: 1, bodySha256: digest("synthetic page") }], entries: [{ path: "README.md", status: "modified", oldMode: "100644", newMode: "100644" }] },
    controlClosure: { complete: true, entries: policy.controlClosure.map((entry) => ({ path: entry.path, baseSha256: entry.sha256, headSha256: entry.sha256, testedSha256: entry.sha256, baseMode: "100644", headMode: "100644", testedMode: "100644" })) },
    runs: [], sarif: [],
  };
  snapshot.rules.currentPrincipalBypass.rulesets = snapshot.rules.applicableRulesets.map((expected) => {
    const detail = { ...expected, enforcement: "active", currentUserCanBypass: "never", request: { method: "GET", route: `/repos/${policy.repository.fullName}/rulesets/${expected.id}`, status: 200, bodyDigest: digest(`synthetic ruleset ${expected.id}`), principal: principal() } };
    return { initial: structuredClone(detail), final: structuredClone(detail) };
  });
  snapshot.runs = policy.runs.map((expected, index) => {
    const run = { role: expected.role, id: 300 + index, repositoryId: policy.repository.id, workflowId: expected.workflowId, path: expected.path, event: "pull_request", attempt: 1, latestAttempt: 1, baseSha: sha("a"), headSha: sha("b"), controlSha: sha("c"), status: "completed", conclusion: "success", jobsComplete: true, totalJobs: expected.jobs.length };
    run.jobs = expected.jobs.map((expectedJob, j) => ({ id: 1000 + index * 100 + j, name: expectedJob.name, runId: run.id, attempt: 1, headSha: sha("b"), status: "completed", conclusion: expected.role === "ci" && ["check", "desktop"].includes(expectedJob.role) ? "skipped" : "success", stepsComplete: true, steps: expected.role === "ci" && ["check", "desktop"].includes(expectedJob.role) ? [] : expectedJob.steps.map((name) => ({ name, status: "completed", conclusion: "success" })) }));
    const sourceJobs = expected.jobs.filter((j) => expected.role !== "ci" || j.role === "scope");
    run.sourceProof = { status: "verified", kind: "trusted-inline-receipt-platform-correlation", receipts: sourceJobs.map((j, k) => ({
      status: "verified", artifactId: 2000 + index * 100 + k, jobId: run.jobs.find((actual) => actual.name === j.name).id,
      artifactName: expected.role === "codeql" ? `merge-evidence-${run.id}-1-${j.role}` : `merge-source-${run.id}-1`,
      receipt: { schemaVersion: 1, repositoryId: policy.repository.id, repository: policy.repository.fullName, runId: run.id, runAttempt: 1, workflowRef: `${policy.repository.fullName}/${run.path}@refs/pull/5/merge`, workflowPath: run.path, workflowSha: sha("d"), workflowSha256: policy.controlClosure.find((e) => e.path === run.path).sha256, event: "pull_request", eventSha: sha("d"), headSha: sha("b"), baseSha: sha("a"), checkoutSha: sha("d"), parents: [sha("a"), sha("b")], jobName: j.name, ...(expected.role === "codeql" ? { language: j.role, category: policy.receiptCategories[j.role] } : {}) },
    })) };
    return run;
  });
  const codeql = snapshot.runs[1];
  snapshot.sarif = languages.map((language) => {
    const source = codeql.sourceProof.receipts.find((entry) => entry.receipt.language === language);
    const rawSarif = JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL", semanticVersion: "2.26.2" } }, automationDetails: { id: policy.sarifCategories[language] }, results: [], invocations: [{ executionSuccessful: true }] }] });
    return { language, jobName: source.receipt.jobName, runId: codeql.id, attempt: 1, headSha: sha("b"), errors: [], rawSarif, sha256: digest(rawSarif), provenance: { status: "verified", artifactId: source.artifactId, artifactName: source.artifactName, jobId: source.jobId, runId: codeql.id, attempt: 1, workflowSha: sha("d") } };
  });
  snapshot.platformGate = { ...policy.platformGate, id: 400, repositoryId: policy.repository.id, headSha: sha("b"), attempt: 1, latestAttempt: 1, status: "completed", conclusion: "success", complete: true, totalJobs: 2, jobs: policy.platformGate.jobs.map((name, index) => ({ id: 3000 + index, name, runId: 400, attempt: 1, headSha: sha("b"), status: "completed", conclusion: "success", stepsComplete: true, steps: ["Initialize CodeQL", "Perform CodeQL Analysis"].map((name) => ({ name, status: "completed", conclusion: "success" })) })) };
  return { policy, snapshot };
}
function rejects(mutate, reason) {
  const { policy, snapshot } = fixture(); mutate(snapshot, policy);
  const result = evaluateMergeEvidence(policy, snapshot);
  assert.equal(result.eligible, false, JSON.stringify(result));
  if (reason) assert.equal(result.reason, reason);
}
function alterSarif(snapshot, mutate) {
  const report = snapshot.sarif[0], document = JSON.parse(report.rawSarif);
  mutate(document); report.rawSarif = JSON.stringify(document); report.sha256 = digest(report.rawSarif);
}

test("three real workflow identities remain distinct in a synthetic positive README observation", () => {
  const { policy, snapshot } = fixture(), before = JSON.stringify({ policy, snapshot });
  const result = evaluateMergeEvidence(policy, snapshot);
  assert.equal(result.eligible, true, JSON.stringify(result));
  assert.deepEqual(result.runs, snapshot.selection.runs.map(({ role, id, attempt }) => ({ role, id, attempt })));
  assert.equal(JSON.stringify({ policy, snapshot }), before);
});
test("inputs are not authentication and unknown collection/source proof always blocks", () => {
  const { policy, snapshot } = fixture(); assert.equal(evaluateMergeEvidence(policy, structuredClone(snapshot)).eligible, true);
  rejects((s) => { s.selection.status = "unavailable"; }, "unverified-selection");
  for (const status of ["blocked", "failure", "pending"]) rejects((s) => { s.collection.status = status; }, "incomplete-collection");
  rejects((s) => { s.collection.drift = true; }, "incomplete-collection");
  for (const key of ["errors", "blockers"]) rejects((s) => { s.collection[key] = ["missing platform evidence"]; }, "incomplete-collection");
  rejects((s) => { s.runs[0].sourceProof.status = "unavailable"; }, "unverified-workflow-source");
});
test("rejects stale repository/base/head/control identities and private Free", () => {
  for (const [key, value, reason] of [["id", 999, "repository-mismatch"], ["fullName", "other/repo", "repository-mismatch"], ["visibility", "private", "private-repository-ineligible"], ["defaultBranchSha", sha("e"), "stale-base"]]) rejects((s) => { s.repository[key] = value; }, reason);
  for (const key of ["baseSha", "headSha"]) rejects((s) => { s.pullRequest[key] = sha("e"); }, key === "baseSha" ? "base-mismatch" : "head-mismatch");
  rejects((s) => { s.pullRequest.number++; }, "pull-request-mismatch");
  rejects((s) => { s.pullRequest.headRepositoryId = 99; }, "head-repository-mismatch");
  rejects((s) => { s.pullRequest.baseAncestorOfHead = false; }, "head-not-up-to-date");
  rejects((s) => { s.controlSha = sha("e"); }, "control-mismatch");
  rejects((s) => { s.collectedAt -= 60_001; }, "stale-observation");
  rejects((s) => { s.collectedAt = s.evaluationTime + 1; }, "stale-observation");
});
test("requires complete strict rules and exact required checks", () => {
  for (const key of ["complete", "requirePullRequest", "strictRequiredChecks"]) rejects((s) => { s.rules[key] = false; }, "unsafe-or-incomplete-rules");
  rejects((s) => { s.rules.requiredChecks.pop(); }, "required-check-mismatch");
  rejects((s) => { s.rules.requiredChecks.push({ context: "unmodeled", appId: 15368 }); }, "required-check-mismatch");
  rejects((s) => { s.rules.requiredChecks[0].appId = 99; }, "required-check-mismatch");
  rejects((s) => { s.rules.codeQuality = "disabled"; }, "native-rule-mismatch");
  rejects((s) => { s.rules.codeScanning.securityThreshold = "critical"; }, "code-scanning-rule-mismatch");
});
test("current request credential never may coexist with other visible bypass actors", () => {
  const { policy, snapshot } = fixture();
  snapshot.rules.bypassActors = [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }];
  assert.equal(evaluateMergeEvidence(policy, snapshot).eligible, true);
  delete snapshot.rules.bypassActors;
  assert.equal(evaluateMergeEvidence(policy, snapshot).eligible, true);
});
test("requires exact coverage of every active applicable ruleset including inherited rules", () => {
  const { policy, snapshot } = fixture();
  const inherited = { id: 900, sourceType: "Organization", source: "openboa-ai" };
  const detail = { ...inherited, enforcement: "active", currentUserCanBypass: "never", request: { method: "GET", route: "/repos/openboa-ai/openboa/rulesets/900", status: 200, bodyDigest: digest("synthetic inherited rule"), principal: principal() } };
  snapshot.rules.applicableRulesets.push(inherited);
  snapshot.rules.currentPrincipalBypass.rulesets.push({ initial: structuredClone(detail), final: structuredClone(detail) });
  assert.equal(evaluateMergeEvidence(policy, snapshot).eligible, true);
  snapshot.rules.currentPrincipalBypass.rulesets[1].final.currentUserCanBypass = "unknown";
  assert.equal(evaluateMergeEvidence(policy, snapshot).reason, "principal-can-bypass-or-unknown");
  rejects((s) => { delete s.rules.applicableRulesets; }, "incomplete-applicable-rulesets");
  rejects((s) => { s.rules.applicableRulesets = []; }, "incomplete-applicable-rulesets");
  rejects((s) => { s.rules.applicableRulesets.push(structuredClone(s.rules.applicableRulesets[0])); }, "duplicate-applicable-ruleset");
  rejects((s) => { s.rules.currentPrincipalBypass.rulesets = []; }, "principal-ruleset-coverage");
  rejects((s) => { s.rules.currentPrincipalBypass.rulesets.push(structuredClone(s.rules.currentPrincipalBypass.rulesets[0])); }, "principal-ruleset-coverage");
  rejects((s) => { const extra = structuredClone(s.rules.currentPrincipalBypass.rulesets[0]); extra.initial.id = extra.final.id = 999; s.rules.currentPrincipalBypass.rulesets.push(extra); }, "principal-ruleset-coverage");
  rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0].initial.id = 999; }, "principal-ruleset-coverage");
  rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0].final.id = 999; }, "ruleset-identity-mismatch");
});
test("unknown bypass result, incomplete reread, source drift and wrong request cannot qualify", () => {
  for (const phase of ["initial", "final"]) {
    for (const value of ["always", "pull_requests_only", "unknown", "NEVER", "", null]) rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0][phase].currentUserCanBypass = value; }, "principal-can-bypass-or-unknown");
    rejects((s) => { delete s.rules.currentPrincipalBypass.rulesets[0][phase].currentUserCanBypass; }, "principal-can-bypass-or-unknown");
    for (const [field, value, reason] of [["sourceType", "Organization", "ruleset-source-mismatch"], ["source", "other/repo", "ruleset-source-mismatch"], ["enforcement", "evaluate", "ruleset-enforcement-mismatch"]]) rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0][phase][field] = value; }, reason);
    for (const [field, value] of [["method", "POST"], ["route", "/repos/other/repo/rulesets/15257114"], ["status", 403], ["bodyDigest", null]]) rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0][phase].request[field] = value; }, "invalid-ruleset-request");
  }
  rejects((s) => { delete s.rules.currentPrincipalBypass.rulesets[0].final; }, "ruleset-identity-mismatch");
  rejects((s) => { s.rules.currentPrincipalBypass.rulesets[0].final.request.bodyDigest = digest("changed rule detail"); }, "ruleset-reread-drift");
  rejects((s) => { s.rules.applicableRulesets[0].source = "other/repo"; }, "ruleset-source-mismatch");
  rejects((s) => { s.rules.currentPrincipalBypass.status = "unavailable"; }, "unverified-principal-bypass");
});
test("report-only current credential evidence cannot be relabeled as a future writer", () => {
  const locations = [s => s.collection, s => s.rules.currentPrincipalBypass, s => s.rules.currentPrincipalBypass.rulesets[0].initial.request, s => s.rules.currentPrincipalBypass.rulesets[0].final.request];
  for (const locate of locations) {
    rejects((s) => { delete locate(s).principal; }, "unverified-current-principal");
    rejects((s) => { locate(s).principal = null; }, "unverified-current-principal");
    rejects((s) => { locate(s).principal.kind = "User"; }, "unverified-current-principal");
    rejects((s) => { locate(s).principal.scope = "future-merge-token"; }, "unverified-current-principal");
    rejects((s) => { locate(s).principal.fingerprint = "not-a-credential"; }, "unverified-current-principal");
  }
});
test("rejects incomplete paginated diff and truncated tree", () => {
  for (const key of ["complete", "treeComplete"]) rejects((s) => { s.files[key] = false; }, "incomplete-files");
  rejects((s) => { s.files.treesTruncated = true; }, "incomplete-files");
  rejects((s) => { s.pullRequest.changedFiles = 2; }, "incomplete-files");
  rejects((s) => { s.files.totalCount = 2; }, "incomplete-files");
  for (const key of ["number", "count"]) rejects((s) => { s.files.pages[0][key] = 2; }, "incomplete-file-pages");
  rejects((s) => { s.files.pages = []; }, "incomplete-file-pages");
  rejects((s) => { s.files.entries.push(structuredClone(s.files.entries[0])); s.files.totalCount = s.pullRequest.changedFiles = s.files.pages[0].count = 2; }, "duplicate-files");
});
test("protected paths on either side of rename and unknown scope deny", () => {
  for (const path of [".github/workflows/ci.yml", "AGENTS.md", ".codex/config.md", ".githooks/pre-commit", "auth/README.md", "deploy/README.md", "release/README.md", "package-lock.json", "tests/README.md", "scripts/install.md", "docs/SECURITY.md", "docs/security-design.md"]) {
    rejects((s) => { s.files.entries[0].path = path; }, "protected-change");
    rejects((s) => { Object.assign(s.files.entries[0], { status: "renamed", previousPath: path }); }, "protected-change");
  }
  rejects((s) => { s.files.entries[0].path = "src/main.js"; }, "unknown-scope");
  rejects((s) => { s.scope = "dependency-update"; }, "unknown-scope");
  rejects((s) => { s.files.entries[0].newMode = "120000"; }, "nonregular-file");
  rejects((s) => { s.files.entries[0].path = "docs/../AGENTS.md"; }, "invalid-file");
  const { policy, snapshot } = fixture(); Object.assign(snapshot.files.entries[0], { status: "renamed", previousPath: "docs/guide.md" });
  assert.equal(evaluateMergeEvidence(policy, snapshot).eligible, true);
});
test("requires unchanged complete base/head/tested workflow and control closure", () => {
  rejects((s) => { s.controlClosure.complete = false; }, "incomplete-control-closure");
  rejects((s) => { s.controlClosure.entries.pop(); }, "control-closure-mismatch");
  for (const key of ["baseSha256", "headSha256", "testedSha256"]) rejects((s) => { s.controlClosure.entries[0][key] = digest("changed"); }, key === "baseSha256" ? "control-closure-mismatch" : "control-closure-changed");
  rejects((s) => { s.controlClosure.entries[0].headMode = "100755"; }, "control-closure-mode");
});
test("binds each distinct latest run to workflow ID/path/event and immutable tuple", () => {
  rejects((s) => { s.runs.pop(); }, "run-set-mismatch");
  rejects((s) => { s.runs.push(structuredClone(s.runs[0])); }, "run-set-mismatch");
  for (let i = 0; i < 3; i++) {
    for (const key of ["id", "attempt", "latestAttempt", "workflowId", "path", "event"]) rejects((s) => { s.runs[i][key] = typeof s.runs[i][key] === "number" ? 999 : "other"; }, `run-${key === "latestAttempt" ? "latest-attempt" : key}-mismatch`);
    for (const [key, reason] of [["baseSha", "run-base-mismatch"], ["headSha", "run-head-mismatch"], ["controlSha", "run-control-mismatch"]]) rejects((s) => { s.runs[i][key] = sha("e"); }, reason);
    rejects((s) => { s.selection.runs[i].attempt = s.selection.runs[i].latestAttempt = 2; }, "invalid-selected-attempt");
    rejects((s) => { s.runs[i].conclusion = "failure"; s.ownerConfirmed = true; s.manualOverride = true; }, "run-not-success");
  }
});
test("receipts bind actual source parents checkout workflow hash and producer job", () => {
  for (let i = 0; i < 3; i++) {
    rejects((s) => { s.runs[i].sourceProof.receipts.pop(); }, "source-receipt-set");
    const cases = { runId: 9, runAttempt: 2, repositoryId: 9, repository: "other/repo", workflowSha: sha("e"), checkoutSha: sha("e"), workflowPath: "other", workflowSha256: digest("bad"), workflowRef: "refs/heads/main", event: "push", eventSha: sha("e"), headSha: sha("e"), baseSha: sha("e"), parents: [sha("b"), sha("a")] };
    for (const [key, value] of Object.entries(cases)) rejects((s) => { s.runs[i].sourceProof.receipts[0].receipt[key] = value; });
    rejects((s) => { s.runs[i].sourceProof.receipts[0].artifactName = "old-artifact"; }, "source-artifact-name");
    rejects((s) => { s.runs[i].sourceProof.receipts[0].jobId = 9; }, "source-producer-mismatch");
  }
});
test("missing duplicate unexpected jobs deny in every workflow", () => {
  for (let i = 0; i < 3; i++) {
    rejects((s) => { s.runs[i].jobs.pop(); s.runs[i].totalJobs--; }, "job-set-mismatch");
    rejects((s) => { s.runs[i].jobs.push(structuredClone(s.runs[i].jobs[0])); s.runs[i].totalJobs++; }, "job-set-mismatch");
    rejects((s) => { s.runs[i].jobs[0].name = "unexpected"; }, "job-set-mismatch");
    rejects((s) => { s.runs[i].jobsComplete = false; }, "incomplete-jobs");
  }
  rejects((s) => { s.runs[0].jobs[1].id = s.runs[0].jobs[0].id; }, "duplicate-job-id");
});
test("only check and desktop may skip after independent documentation classification", () => {
  const { snapshot } = fixture();
  for (let r = 0; r < 3; r++) for (let j = 0; j < snapshot.runs[r].jobs.length; j++) {
    const optional = r === 0 && ["check", "desktop-artifact"].includes(snapshot.runs[r].jobs[j].name);
    for (const result of ["neutral", "failure", "cancelled", "", null, ...(optional ? [] : ["skipped"])]) rejects((s) => { s.runs[r].jobs[j].conclusion = result; s.ownerConfirmed = true; }, "job-not-success");
    if (!optional) for (const result of ["skipped", "neutral", "failure", "cancelled", "", null]) rejects((s) => { s.runs[r].jobs[j].steps[0].conclusion = result; }, "step-not-success");
  }
  rejects((s) => { s.runs[0].jobs[5].steps = [{ name: "Run checks", status: "completed", conclusion: "failure" }]; }, "skipped-job-has-steps");
  rejects((s) => { s.files.entries[0].path = "src/main.js"; s.candidateScope = { docs_only: true }; }, "unknown-scope");
  rejects((s) => { s.runs[0].jobs[0].steps = []; }, "step-not-success");
  rejects((s) => { s.runs[0].jobs[0].steps.push(structuredClone(s.runs[0].jobs[0].steps[0])); }, "step-not-success");
});
test("requires actual clean platform mergeability, with no owner override", () => {
  for (const value of [false, null]) rejects((s) => { s.pullRequest.mergeable = value; s.ownerConfirmed = true; }, "platform-not-ready");
  for (const value of ["unknown", "dirty", "blocked", "behind", "unstable", null]) rejects((s) => { s.pullRequest.mergeableState = value; s.ownerConfirmed = true; }, "platform-not-ready");
});
test("native Code Quality stays a separate exact platform gate", () => {
  rejects((s) => { s.platformGate.conclusion = "failure"; }, "native-gate-unavailable-or-failed");
  rejects((s) => { s.platformGate.complete = false; }, "native-gate-unavailable-or-failed");
  rejects((s) => { s.platformGate.headSha = sha("e"); }, "native-head-mismatch");
  rejects((s) => { s.platformGate.workflowId = 262978664; }, "native-identity-mismatch");
  rejects((s) => { s.platformGate.jobs.pop(); s.platformGate.totalJobs--; }, "native-job-set");
  rejects((s) => { s.platformGate.jobs[0].conclusion = "neutral"; }, "native-job-failed");
  rejects((s) => { s.platformGate.jobs[0].steps[0].conclusion = "skipped"; }, "native-step-failed");
});
test("requires raw SARIF for all three languages bound to exact source artifact and run", () => {
  rejects((s) => { s.sarif.pop(); s.apiAlertCount = 0; }, "sarif-language-set");
  rejects((s) => { s.sarif.push(structuredClone(s.sarif[0])); }, "sarif-language-set");
  rejects((s) => { delete s.sarif[0].rawSarif; }, "missing-or-oversized-raw-sarif");
  rejects((s) => { s.sarif[0].sha256 = digest("bad"); }, "sarif-digest-mismatch");
  rejects((s) => { s.sarif[0].errors = ["extractor failure"]; }, "sarif-errors");
  for (const key of ["runId", "attempt", "jobId", "artifactId"]) rejects((s) => { s.sarif[0].provenance[key] = 99; });
  rejects((s) => { s.sarif[0].runId = 300; }, "sarif-run-mismatch");
  rejects((s) => { s.sarif[0].provenance.status = "unavailable"; }, "unverified-sarif-provenance");
});
test("raw findings including suppressions, missing results, failed extraction and errors deny", () => {
  rejects((s) => alterSarif(s, (d) => { d.runs[0].results = [{ ruleId: "finding", suppressions: [{ status: "accepted" }] }]; }), "sarif-findings-or-missing-results");
  rejects((s) => alterSarif(s, (d) => { delete d.runs[0].results; }), "sarif-findings-or-missing-results");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].invocations[0].executionSuccessful = false; }), "sarif-execution-failed");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].invocations = []; }), "missing-sarif-invocations");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].invocations[0].toolExecutionNotifications = [{ level: "error" }]; }), "sarif-error-notification");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].automationDetails.id = "other"; }), "sarif-category-mismatch");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].tool.driver.semanticVersion = "1.0.0"; }), "sarif-tool-mismatch");
});
test("empty inline results cannot hide external result/property data", () => {
  rejects((s) => alterSarif(s, (d) => { d.runs[0].externalPropertyFileReferences = { results: [{ location: { uri: "results.sarif-external-properties" }, guid: "external", itemCount: 1 }] }; }), "sarif-external-properties");
  rejects((s) => alterSarif(s, (d) => { d.inlineExternalProperties = [{ version: "2.1.0", guid: "external", results: [{ ruleId: "hidden-finding" }] }]; }), "sarif-external-properties");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].externalPropertyFileReferences = { unknown: [] }; }), "sarif-external-properties");
  rejects((s) => alterSarif(s, (d) => { d.inlineExternalProperties = {}; }), "sarif-external-properties");
});
test("inconsistent duplicate source artifact identities and conversion errors deny", () => {
  rejects((s) => {
    const sources = s.runs[1].sourceProof.receipts;
    for (const entry of sources) entry.artifactId = sources[0].artifactId;
    for (const report of s.sarif) report.provenance.artifactId = sources[0].artifactId;
  }, "duplicate-source-artifact");
  rejects((s) => {
    s.runs[2].sourceProof.receipts[0].artifactId = s.runs[0].sourceProof.receipts[0].artifactId;
  }, "duplicate-source-artifact");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].conversion = { invocation: { executionSuccessful: true, toolExecutionNotifications: [{ level: "error" }] } }; }), "sarif-conversion-unsupported");
  rejects((s) => alterSarif(s, (d) => { d.runs[0].conversion = { invocation: { executionSuccessful: true } }; }), "sarif-conversion-unsupported");
});
test("binds the native observed run to its separately selected current tuple", () => {
  rejects((s) => { delete s.selection.platformGate; }, "invalid-native-selection");
  rejects((s) => { s.selection.platformGate.id = 999; }, "native-selection-mismatch");
  for (const key of ["attempt", "latestAttempt"]) rejects((s) => { s.selection.platformGate[key] = 2; }, "invalid-native-selection");
});
test("policy is independent and cannot lose security jobs, languages or protected paths", () => {
  rejects((s) => { s.candidatePolicy = { allowedDocumentationPaths: ["src/main.js"] }; s.files.entries[0].path = "src/main.js"; }, "unknown-scope");
  rejects((_s, p) => { p.allowedDocumentationPaths.push("AGENTS.md"); }, "invalid-policy-documentation-paths");
  rejects((_s, p) => { p.runs[0].jobs.splice(2, 1); }, "invalid-policy-jobs");
  rejects((_s, p) => { p.runs[1].jobs.pop(); }, "invalid-policy-jobs");
  rejects((_s, p) => { p.trustModel = "artifact-is-authentication"; }, "invalid-policy");
});
test("rejects non-JSON accessors without running them and bounds input", () => {
  const { policy, snapshot } = fixture(); let executed = false;
  Object.defineProperty(snapshot, "trap", { get() { executed = true; throw Error("executed"); } });
  assert.equal(evaluateMergeEvidence(policy, snapshot).eligible, false); assert.equal(executed, false);
  rejects((s) => { s.extra = "x".repeat(8 * 1024 * 1024 + 1); }, "input-budget");
});
test("library has no network shell filesystem or merge command path", () => {
  const source = readFileSync(new URL("../lib/evaluate-merge-evidence.mjs", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]), ["node:crypto"]);
  assert.doesNotMatch(source, /\b(?:fetch|spawn|execFile|writeFile|readFile|process)\b/u);
});
