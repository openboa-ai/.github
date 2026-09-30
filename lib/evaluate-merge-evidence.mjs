import { createHash } from "node:crypto";

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const JOB_ROLES = {
  ci: ["scope", "policy", "secrets", "gitleaks", "dependencies", "check", "docs", "desktop", "aggregate"],
  codeql: ["actions", "javascript-typescript", "python"],
  convention: ["convention"],
};
const CODEQL_LANGUAGES = ["actions", "javascript-typescript", "python"];
const PROTECTED_SEGMENTS = /^(?:\.git|\.github|\.agents?|\.codex|\.claude|\.cursor|\.windsurf|\.aider|\.githooks|hooks?|auth|authentication|authorization|deploy(?:ment)?s?|releases?|scripts?|tests?|__tests__|config|node_modules|vendor)$/iu;
const PROTECTED_NAMES = /^(?:AGENTS?\.md|SKILL\.md|CLAUDE\.md|GEMINI\.md|CODEOWNERS|SECURITY\.md|\.gitignore|\.gitattributes|\.npmrc|\.yarnrc.*|package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|deno\.(?:jsonc?|lock)|requirements[^/]*|pyproject\.toml|uv\.lock|poetry\.lock|Pipfile(?:\.lock)?|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|Makefile|Dockerfile.*|.*(?:lock|install|test|build|deploy|release|auth).*\.(?:json|ya?ml|toml|[cm]?js|ts|sh))$/iu;

function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function same(actual, expected, code) { requireValue(actual === expected, code); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function exactSet(actual, expected, code) {
  requireValue(Array.isArray(actual) && new Set(actual).size === actual.length && actual.length === expected.length && actual.every((item) => expected.includes(item)), code);
}
function safePath(path) {
  return typeof path === "string" && path.length <= 512 && !/[\\\x00-\x20\x7f:%?#]/u.test(path) && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== "..");
}
function protectedPath(path) {
  return path.split("/").some((part) => PROTECTED_SEGMENTS.test(part) || PROTECTED_NAMES.test(part));
}
// Reject executable object accessors/prototypes and excessive input before reading fields.
function requireJsonData(value) {
  const seen = new Set();
  let nodes = 0, bytes = 0;
  function visit(item, depth) {
    requireValue(++nodes <= 50_000 && depth <= 24, "input-budget");
    if (typeof item === "string") { bytes += Buffer.byteLength(item); requireValue(bytes <= 8 * 1024 * 1024, "input-budget"); return; }
    if (item === null || typeof item === "boolean" || (typeof item === "number" && Number.isSafeInteger(item))) return;
    requireValue(typeof item === "object" && !seen.has(item), "non-json-input");
    seen.add(item);
    const proto = Object.getPrototypeOf(item);
    requireValue(proto === (Array.isArray(item) ? Array.prototype : Object.prototype) || proto === null, "non-json-input");
    requireValue(Object.getOwnPropertySymbols(item).length === 0, "non-json-input");
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
      requireValue("value" in descriptor, "non-json-input");
      visit(descriptor.value, depth + 1);
    }
  }
  visit(value, 0);
}
function requirePolicy(policy) {
  requireValue(record(policy) && policy.version === 1 && policy.trustModel === "trusted-solo-writer" && policy.deploymentPlan === "free", "invalid-policy");
  requireValue(record(policy.repository) && positive(policy.repository.id) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(policy.repository.fullName), "invalid-policy-repository");
  requireValue(SHA.test(policy.controlSha), "invalid-policy-sha");
  requireValue(positive(policy.maxAgeMs) && policy.maxAgeMs <= 300_000, "invalid-policy-freshness");
  requireValue(Array.isArray(policy.runs), "invalid-policy-runs");
  exactSet(policy.runs.map((run) => run.role), Object.keys(JOB_ROLES), "invalid-policy-runs");
  exactSet(policy.runs.map((run) => run.workflowId), [...new Set(policy.runs.map((run) => run.workflowId))], "invalid-policy-runs");
  for (const run of policy.runs) {
    requireValue(positive(run.workflowId) && safePath(run.path) && run.path.startsWith(".github/workflows/") && run.event === "pull_request" && Array.isArray(run.jobs), "invalid-policy-run");
    exactSet(run.jobs.map((job) => job.role), JOB_ROLES[run.role], "invalid-policy-jobs");
    exactSet(run.jobs.map((job) => job.name), [...new Set(run.jobs.map((job) => job.name))], "invalid-policy-jobs");
    for (const job of run.jobs) {
      requireValue(typeof job.name === "string" && job.name.length > 0 && job.name.length <= 200 && Array.isArray(job.steps) && job.steps.length > 0 && job.steps.length <= 30 && job.steps.every((name) => typeof name === "string" && name.length > 0 && name.length <= 200), "invalid-policy-job");
      exactSet(job.steps, [...new Set(job.steps)], "invalid-policy-steps");
    }
  }
  requireValue(Array.isArray(policy.requiredChecks), "invalid-policy-checks");
  exactSet(policy.requiredChecks.map((check) => check.context), [policy.runs.find((r) => r.role === "ci").jobs.find((j) => j.role === "aggregate").name, policy.runs.find((r) => r.role === "convention").jobs[0].name], "invalid-policy-checks");
  requireValue(policy.requiredChecks.every((check) => positive(check.appId)), "invalid-policy-checks");
  const native = policy.platformGate;
  requireValue(record(native) && positive(native.workflowId) && native.path === "dynamic/github-code-quality/codeql" && native.event === "dynamic" && positive(native.appId), "invalid-policy-native");
  requireValue(Array.isArray(native.jobs), "invalid-policy-native");
  exactSet(native.jobs, ["Analyze (python)", "Analyze (javascript-typescript)"], "invalid-policy-native");
  requireValue(Array.isArray(policy.allowedDocumentationPaths) && policy.allowedDocumentationPaths.length > 0 && policy.allowedDocumentationPaths.length <= 100 && policy.allowedDocumentationPaths.every((path) => safePath(path) && path.endsWith(".md") && !protectedPath(path)), "invalid-policy-documentation-paths");
  exactSet(policy.allowedDocumentationPaths, [...new Set(policy.allowedDocumentationPaths)], "invalid-policy-documentation-paths");
  requireValue(Array.isArray(policy.protectedPaths) && policy.protectedPaths.every(safePath), "invalid-policy-protected-paths");
  requireValue(Array.isArray(policy.controlClosure) && policy.controlClosure.length > 0 && policy.controlClosure.length <= 100, "invalid-policy-closure");
  for (const entry of policy.controlClosure) requireValue(record(entry) && safePath(entry.path) && DIGEST.test(entry.sha256), "invalid-policy-closure");
  exactSet(policy.controlClosure.map((entry) => entry.path), [...new Set(policy.controlClosure.map((entry) => entry.path))], "invalid-policy-closure");
  requireValue(policy.runs.every((run) => policy.controlClosure.some((entry) => entry.path === run.path)), "workflow-not-in-closure");
  requireValue(record(policy.receiptCategories), "invalid-policy-categories");
  exactSet(Object.keys(policy.receiptCategories), CODEQL_LANGUAGES, "invalid-policy-categories");
  for (const category of Object.values(policy.receiptCategories)) requireValue(typeof category === "string" && category.length > 0 && category.length <= 300, "invalid-policy-categories");
  requireValue(record(policy.sarifCategories), "invalid-policy-categories");
  exactSet(Object.keys(policy.sarifCategories), CODEQL_LANGUAGES, "invalid-policy-categories");
  for (const category of Object.values(policy.sarifCategories)) requireValue(typeof category === "string" && category.length > 0 && category.length <= 300, "invalid-policy-categories");
  exactSet(Object.values(policy.sarifCategories), [...new Set(Object.values(policy.sarifCategories))], "invalid-policy-categories");
  requireValue(typeof policy.codeqlVersion === "string" && /^\d+\.\d+\.\d+$/u.test(policy.codeqlVersion), "invalid-policy-codeql");
}
function requireCurrentPrincipal(principal) {
  requireValue(record(principal), "unverified-current-principal");
  exactSet(Object.keys(principal), ["kind", "scope"], "unverified-current-principal");
  requireValue(principal.kind === "current-request-credential" && principal.scope === "report-only-collector", "unverified-current-principal");
}
function requirePrincipalBypass(policy, snapshot) {
  requireCurrentPrincipal(snapshot.collection.principal);
  const { rules } = snapshot;
  requireValue(Array.isArray(rules.applicableRulesets) && rules.applicableRulesets.length > 0 && rules.applicableRulesets.length <= 100, "incomplete-applicable-rulesets");
  const ids = rules.applicableRulesets.map((entry) => entry.id);
  requireValue(ids.every(positive), "invalid-ruleset-identity");
  exactSet(ids, [...new Set(ids)], "duplicate-applicable-ruleset");
  for (const expected of rules.applicableRulesets) {
    requireValue((expected.sourceType === "Repository" && expected.source === policy.repository.fullName) || (expected.sourceType === "Organization" && expected.source === policy.repository.fullName.split("/")[0]), "ruleset-source-mismatch");
  }
  const proof = rules.currentPrincipalBypass;
  requireValue(record(proof) && proof.status === "verified" && Array.isArray(proof.rulesets), "unverified-principal-bypass");
  requireCurrentPrincipal(proof.principal);
  exactSet(proof.rulesets.map((entry) => entry.initial?.id), ids, "principal-ruleset-coverage");
  for (const expected of rules.applicableRulesets) {
    const observed = proof.rulesets.find((entry) => entry.initial.id === expected.id);
    for (const detail of [observed.initial, observed.final]) {
      requireValue(record(detail) && detail.id === expected.id, "ruleset-identity-mismatch");
      requireValue(detail.sourceType === expected.sourceType && detail.source === expected.source, "ruleset-source-mismatch");
      same(detail.enforcement, "active", "ruleset-enforcement-mismatch");
      same(detail.currentUserCanBypass, "never", "principal-can-bypass-or-unknown");
      const request = detail.request;
      requireValue(record(request) && request.method === "GET" && request.route === `/repos/${policy.repository.fullName}/rulesets/${expected.id}` && request.status === 200 && DIGEST.test(request.bodyDigest), "invalid-ruleset-request");
      requireCurrentPrincipal(request.principal);
    }
    same(observed.final.request.bodyDigest, observed.initial.request.bodyDigest, "ruleset-reread-drift");
  }
}
function requireFiles(policy, snapshot) {
  const { files, pullRequest } = snapshot;
  requireValue(record(files) && files.complete === true && files.treeComplete === true && files.treesTruncated === false && Array.isArray(files.entries) && positive(files.totalCount) && files.totalCount <= 100 && files.entries.length === files.totalCount && pullRequest.changedFiles === files.totalCount, "incomplete-files");
  requireValue(Array.isArray(files.pages) && files.pages.length > 0 && files.pages.every((page, index) => record(page) && page.number === index + 1 && Number.isSafeInteger(page.count) && page.count >= 0 && DIGEST.test(page.bodySha256)) && files.pages.reduce((sum, page) => sum + page.count, 0) === files.totalCount, "incomplete-file-pages");
  const names = [];
  for (const file of files.entries) {
    requireValue(record(file) && ["added", "modified", "removed", "renamed"].includes(file.status) && safePath(file.path), "invalid-file");
    names.push(file.path);
    const oldPath = file.status === "renamed" ? file.previousPath : file.path;
    requireValue(safePath(oldPath) && (file.status === "renamed" ? oldPath !== file.path : file.previousPath === undefined), "invalid-rename");
    same(file.oldMode, file.status === "added" ? null : "100644", "nonregular-file");
    same(file.newMode, file.status === "removed" ? null : "100644", "nonregular-file");
    for (const path of [file.path, oldPath]) {
      requireValue(!protectedPath(path) && !policy.protectedPaths.some((protectedRoot) => path === protectedRoot || path.startsWith(`${protectedRoot}/`)) && !policy.controlClosure.some((entry) => path === entry.path), "protected-change");
      requireValue(policy.allowedDocumentationPaths.includes(path), "unknown-scope");
    }
  }
  exactSet(names, [...new Set(names)], "duplicate-files");
  same(snapshot.scope, "allowlisted-documentation", "unknown-scope");
}
function requireClosure(policy, closure) {
  requireValue(record(closure) && closure.complete === true && Array.isArray(closure.entries), "incomplete-control-closure");
  exactSet(closure.entries.map((entry) => entry.path), policy.controlClosure.map((entry) => entry.path), "control-closure-mismatch");
  for (const expected of policy.controlClosure) {
    const actual = closure.entries.find((entry) => entry.path === expected.path);
    same(actual.baseSha256, expected.sha256, "control-closure-mismatch");
    same(actual.headSha256, expected.sha256, "control-closure-changed");
    same(actual.testedSha256, expected.sha256, "control-closure-changed");
    same(actual.baseMode, "100644", "control-closure-mode");
    same(actual.headMode, "100644", "control-closure-mode");
    same(actual.testedMode, "100644", "control-closure-mode");
  }
}
function requireJobs(expectedRun, run, selection) {
  requireValue(run.jobsComplete === true && Array.isArray(run.jobs) && run.totalJobs === run.jobs.length, "incomplete-jobs");
  exactSet(run.jobs.map((job) => job.name), expectedRun.jobs.map((job) => job.name), "job-set-mismatch");
  const ids = run.jobs.map((job) => job.id);
  requireValue(ids.every(positive), "invalid-job-id");
  exactSet(ids, [...new Set(ids)], "duplicate-job-id");
  for (const expected of expectedRun.jobs) {
    const job = run.jobs.find((entry) => entry.name === expected.name);
    same(job.runId, run.id, "job-run-mismatch");
    same(job.attempt, run.attempt, "job-attempt-mismatch");
    same(job.headSha, selection.headSha, "job-sha-mismatch");
    same(job.status, "completed", "job-incomplete");
    // requireFiles already independently established every old/new path is an allowed document.
    const maySkip = expectedRun.role === "ci" && ["check", "desktop"].includes(expected.role);
    requireValue(job.conclusion === "success" || (maySkip && job.conclusion === "skipped"), "job-not-success");
    requireValue(job.stepsComplete === true && Array.isArray(job.steps), "incomplete-steps");
    if (job.conclusion === "skipped") { same(job.steps.length, 0, "skipped-job-has-steps"); continue; }
    for (const name of expected.steps) {
      const steps = job.steps.filter((step) => step.name === name);
      requireValue(steps.length === 1 && steps[0].status === "completed" && steps[0].conclusion === "success", "step-not-success");
    }
  }
}
function requireSource(policy, expectedRun, run, selection) {
  const proof = run.sourceProof;
  requireValue(record(proof) && proof.status === "verified" && proof.kind === "trusted-inline-receipt-platform-correlation" && Array.isArray(proof.receipts), "unverified-workflow-source");
  const roles = expectedRun.role === "ci" ? ["scope"] : JOB_ROLES[expectedRun.role];
  const expectedJobs = expectedRun.jobs.filter((job) => roles.includes(job.role));
  exactSet(proof.receipts.map((entry) => entry.receipt?.jobName), expectedJobs.map((job) => job.name), "source-receipt-set");
  for (const envelope of proof.receipts) {
    requireValue(positive(envelope.artifactId) && envelope.status === "verified", "unverified-source-artifact");
    const receipt = envelope.receipt;
    const expectedJob = expectedJobs.find((job) => job.name === receipt.jobName);
    const actualJob = run.jobs.find((job) => job.name === receipt.jobName);
    same(envelope.jobId, actualJob.id, "source-producer-mismatch");
    const artifactName = expectedRun.role === "codeql" ? `merge-evidence-${run.id}-${run.attempt}-${expectedJob.role}` : `merge-source-${run.id}-${run.attempt}`;
    same(envelope.artifactName, artifactName, "source-artifact-name");
    same(receipt.schemaVersion, 1, "source-schema");
    same(receipt.repositoryId, policy.repository.id, "source-repository-mismatch");
    same(receipt.repository, policy.repository.fullName, "source-repository-mismatch");
    same(receipt.runId, run.id, "source-run-mismatch");
    same(receipt.runAttempt, run.attempt, "source-attempt-mismatch");
    same(receipt.workflowPath, expectedRun.path, "source-path-mismatch");
    same(receipt.workflowRef, `${policy.repository.fullName}/${expectedRun.path}@refs/pull/${selection.pullRequestNumber}/merge`, "source-ref-mismatch");
    same(receipt.workflowSha, selection.testedSha, "workflow-source-mismatch");
    same(receipt.workflowSha256, policy.controlClosure.find((entry) => entry.path === expectedRun.path).sha256, "workflow-source-digest");
    same(receipt.event, expectedRun.event, "source-event-mismatch");
    same(receipt.eventSha, selection.testedSha, "source-event-sha-mismatch");
    same(receipt.checkoutSha, selection.testedSha, "checkout-sha-mismatch");
    same(receipt.baseSha, selection.baseSha, "source-base-mismatch");
    same(receipt.headSha, selection.headSha, "source-head-mismatch");
    requireValue(Array.isArray(receipt.parents) && receipt.parents.length === 2 && receipt.parents[0] === selection.baseSha && receipt.parents[1] === selection.headSha, "source-parent-mismatch");
    if (expectedRun.role === "codeql") {
      same(receipt.language, expectedJob.role, "source-language-mismatch");
      same(receipt.category, policy.receiptCategories[expectedJob.role], "source-category-mismatch");
    }
  }
}
function requireSarif(policy, reports, run, selection) {
  const expectedRun = policy.runs.find((item) => item.role === "codeql");
  const jobs = run.jobs;
  requireValue(Array.isArray(reports), "missing-sarif");
  exactSet(reports.map((report) => report.language), CODEQL_LANGUAGES, "sarif-language-set");
  for (const report of reports) {
    same(report.runId, run.id, "sarif-run-mismatch");
    same(report.attempt, run.attempt, "sarif-attempt-mismatch");
    same(report.headSha, selection.headSha, "sarif-sha-mismatch");
    same(report.jobName, expectedRun.jobs.find((job) => job.role === report.language).name, "sarif-job-mismatch");
    const provenance = report.provenance;
    requireValue(record(provenance) && provenance.status === "verified" && positive(provenance.artifactId), "unverified-sarif-provenance");
    const producer = jobs.find((job) => job.name === report.jobName);
    same(provenance.jobId, producer.id, "sarif-producer-mismatch");
    same(provenance.runId, run.id, "sarif-provenance-run-mismatch");
    same(provenance.attempt, run.attempt, "sarif-provenance-attempt-mismatch");
    same(provenance.workflowSha, selection.testedSha, "sarif-source-mismatch");
    const sourceEnvelope = run.sourceProof.receipts.find((entry) => entry.receipt.jobName === report.jobName);
    same(provenance.artifactId, sourceEnvelope.artifactId, "sarif-artifact-mismatch");
    same(provenance.artifactName, sourceEnvelope.artifactName, "sarif-artifact-mismatch");
    requireValue(Array.isArray(report.errors) && report.errors.length === 0, "sarif-errors");
    requireValue(typeof report.rawSarif === "string" && Buffer.byteLength(report.rawSarif) > 0 && Buffer.byteLength(report.rawSarif) <= 2 * 1024 * 1024, "missing-or-oversized-raw-sarif");
    same(createHash("sha256").update(report.rawSarif).digest("hex"), report.sha256, "sarif-digest-mismatch");
    const document = JSON.parse(report.rawSarif);
    requireValue(document.version === "2.1.0" && Array.isArray(document.runs) && document.runs.length === 1, "invalid-sarif");
    requireValue(document.inlineExternalProperties === undefined || (Array.isArray(document.inlineExternalProperties) && document.inlineExternalProperties.length === 0), "sarif-external-properties");
    const sarifRun = document.runs[0];
    requireValue(sarifRun.externalPropertyFileReferences === undefined || (record(sarifRun.externalPropertyFileReferences) && Object.keys(sarifRun.externalPropertyFileReferences).length === 0), "sarif-external-properties");
    requireValue(sarifRun.tool?.driver?.name === "CodeQL" && sarifRun.tool.driver.semanticVersion === policy.codeqlVersion, "sarif-tool-mismatch");
    same(sarifRun.automationDetails?.id, policy.sarifCategories[report.language], "sarif-category-mismatch");
    requireValue(Array.isArray(sarifRun.results) && sarifRun.results.length === 0, "sarif-findings-or-missing-results");
    requireValue(Array.isArray(sarifRun.invocations) && sarifRun.invocations.length > 0, "missing-sarif-invocations");
    for (const invocation of sarifRun.invocations) {
      same(invocation.executionSuccessful, true, "sarif-execution-failed");
      for (const field of ["toolExecutionNotifications", "toolConfigurationNotifications"]) {
        const notifications = invocation[field] ?? [];
        requireValue(Array.isArray(notifications) && notifications.every((item) => record(item) && ["none", "note", "warning"].includes(item.level)), "sarif-error-notification");
      }
    }
    requireValue(sarifRun.conversion === undefined, "sarif-conversion-unsupported");
  }
}

/** Pure eligibility calculation. Input authenticity and collection are explicitly external. */
export function evaluateMergeEvidence(policy, snapshot) {
  try {
    requireJsonData(policy);
    requireJsonData(snapshot);
    requirePolicy(policy);
    requireValue(record(snapshot) && snapshot.version === 1, "invalid-snapshot");
    requireValue(record(snapshot.collection) && snapshot.collection.status === "completed" && snapshot.collection.drift === false && Array.isArray(snapshot.collection.errors) && snapshot.collection.errors.length === 0 && Array.isArray(snapshot.collection.blockers) && snapshot.collection.blockers.length === 0, "incomplete-collection");
    const selection = snapshot.selection;
    requireValue(record(selection) && selection.status === "verified" && positive(selection.pullRequestNumber), "unverified-selection");
    for (const key of ["baseSha", "headSha", "testedSha"]) requireValue(SHA.test(selection[key]), "invalid-selection-sha");
    requireValue(new Set([selection.baseSha, selection.headSha, selection.testedSha]).size === 3, "invalid-selection-sha");
    requireValue(positive(snapshot.evaluationTime) && positive(snapshot.collectedAt) && snapshot.collectedAt <= snapshot.evaluationTime && snapshot.evaluationTime - snapshot.collectedAt <= policy.maxAgeMs, "stale-observation");
    same(snapshot.repository?.id, policy.repository.id, "repository-mismatch");
    same(snapshot.repository?.fullName, policy.repository.fullName, "repository-mismatch");
    same(snapshot.repository?.visibility, "public", "private-repository-ineligible");
    requireValue(record(snapshot.pullRequest) && snapshot.pullRequest.state === "open" && snapshot.pullRequest.draft === false, "pull-request-ineligible");
    same(snapshot.pullRequest.number, selection.pullRequestNumber, "pull-request-mismatch");
    same(snapshot.pullRequest.baseSha, selection.baseSha, "base-mismatch");
    same(snapshot.repository.defaultBranchSha, selection.baseSha, "stale-base");
    same(snapshot.pullRequest.headSha, selection.headSha, "head-mismatch");
    same(snapshot.pullRequest.headRepositoryId, policy.repository.id, "head-repository-mismatch");
    same(snapshot.pullRequest.baseAncestorOfHead, true, "head-not-up-to-date");
    requireValue(snapshot.pullRequest.mergeable === true && snapshot.pullRequest.mergeableState === "clean", "platform-not-ready");
    same(snapshot.controlSha, policy.controlSha, "control-mismatch");
    const rules = snapshot.rules;
    requireValue(record(rules) && rules.complete === true && rules.enforcement === "active" && rules.requirePullRequest === true && rules.strictRequiredChecks === true && Array.isArray(rules.requiredChecks), "unsafe-or-incomplete-rules");
    requirePrincipalBypass(policy, snapshot);
    exactSet(rules.requiredChecks.map((check) => `${check.appId}:${check.context}`), policy.requiredChecks.map((check) => `${check.appId}:${check.context}`), "required-check-mismatch");
    same(rules.codeQuality, "errors", "native-rule-mismatch");
    requireValue(rules.codeScanning?.tool === "CodeQL" && rules.codeScanning.securityThreshold === "high_or_higher" && rules.codeScanning.alertsThreshold === "errors", "code-scanning-rule-mismatch");
    requireFiles(policy, snapshot);
    requireClosure(policy, snapshot.controlClosure);
    requireValue(Array.isArray(selection.runs) && Array.isArray(snapshot.runs), "missing-runs");
    exactSet(selection.runs.map((run) => run.role), Object.keys(JOB_ROLES), "run-set-mismatch");
    exactSet(snapshot.runs.map((run) => run.role), Object.keys(JOB_ROLES), "run-set-mismatch");
    exactSet(selection.runs.map((run) => run.id), [...new Set(selection.runs.map((run) => run.id))], "duplicate-run-id");
    for (const expected of policy.runs) {
      const selected = selection.runs.find((run) => run.role === expected.role);
      const run = snapshot.runs.find((run) => run.role === expected.role);
      requireValue(positive(selected.id) && selected.attempt === 1 && selected.latestAttempt === selected.attempt, "invalid-selected-attempt");
      same(run.id, selected.id, "run-id-mismatch");
      same(run.attempt, selected.attempt, "run-attempt-mismatch");
      same(run.latestAttempt, selected.latestAttempt, "run-latest-attempt-mismatch");
      for (const field of ["workflowId", "path", "event"]) same(run[field], expected[field], `run-${field}-mismatch`);
      same(run.repositoryId, policy.repository.id, "run-repository-mismatch");
      same(run.baseSha, selection.baseSha, "run-base-mismatch");
      same(run.headSha, selection.headSha, "run-head-mismatch");
      same(run.controlSha, policy.controlSha, "run-control-mismatch");
      same(run.status, "completed", "run-incomplete");
      same(run.conclusion, "success", "run-not-success");
      requireJobs(expected, run, selection);
      requireSource(policy, expected, run, selection);
    }
    const artifactIds = snapshot.runs.flatMap((run) => run.sourceProof.receipts.map((entry) => entry.artifactId));
    exactSet(artifactIds, [...new Set(artifactIds)], "duplicate-source-artifact");
    const native = snapshot.platformGate;
    const nativePolicy = policy.platformGate;
    requireValue(record(native) && native.status === "completed" && native.conclusion === "success" && native.complete === true, "native-gate-unavailable-or-failed");
    const selectedNative = selection.platformGate;
    requireValue(record(selectedNative) && positive(selectedNative.id) && selectedNative.attempt === 1 && selectedNative.latestAttempt === 1, "invalid-native-selection");
    for (const key of ["id", "attempt", "latestAttempt"]) same(native[key], selectedNative[key], "native-selection-mismatch");
    requireValue(positive(native.id) && native.attempt === 1 && native.latestAttempt === 1 && !selection.runs.some((run) => run.id === native.id), "native-run-mismatch");
    for (const key of ["workflowId", "path", "event", "appId"]) same(native[key], nativePolicy[key], "native-identity-mismatch");
    same(native.repositoryId, policy.repository.id, "native-repository-mismatch");
    same(native.headSha, selection.headSha, "native-head-mismatch");
    requireValue(Array.isArray(native.jobs) && native.totalJobs === native.jobs.length, "native-jobs-incomplete");
    exactSet(native.jobs.map((job) => job.name), nativePolicy.jobs, "native-job-set");
    exactSet(native.jobs.map((job) => job.id), [...new Set(native.jobs.map((job) => job.id))], "native-job-set");
    for (const job of native.jobs) {
      requireValue(positive(job.id) && job.runId === native.id && job.attempt === native.attempt && job.headSha === selection.headSha && job.status === "completed" && job.conclusion === "success", "native-job-failed");
      requireValue(job.stepsComplete === true && Array.isArray(job.steps), "native-steps-incomplete");
      for (const name of ["Initialize CodeQL", "Perform CodeQL Analysis"]) {
        const steps = job.steps.filter((step) => step.name === name);
        requireValue(steps.length === 1 && steps[0].status === "completed" && steps[0].conclusion === "success", "native-step-failed");
      }
    }
    requireSarif(policy, snapshot.sarif, snapshot.runs.find((run) => run.role === "codeql"), selection);
    return { eligible: true, classification: "allowlisted-documentation", repository: policy.repository.fullName, headSha: selection.headSha, testedSha: selection.testedSha, runs: selection.runs.map(({ role, id, attempt }) => ({ role, id, attempt })) };
  } catch (error) {
    return { eligible: false, reason: error instanceof SyntaxError ? "invalid-json" : error instanceof Error ? error.message : "invalid-evidence" };
  }
}
