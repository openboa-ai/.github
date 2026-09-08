import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateCandidateWorkflowDelegation } from "./classify-candidate.mjs";

export function readJson(root, path) {
  const file = resolve(root, path);
  assert.ok(lstatSync(file).isFile(), `${path}: regular file required`);
  const bytes = readFileSync(file);
  assert.ok(bytes.length <= 8 * 1024 * 1024, `${path}: oversized control data`);
  return JSON.parse(bytes.toString("utf8"));
}

export function validatePackage(root) {
  const pkg = readJson(root, "package.json");
  const lock = readJson(root, "package-lock.json");
  assert.equal(pkg.private, true, "verification packages must remain private");
  assert.equal(typeof pkg.scripts?.verify, "string", "npm run verify is required");
  assert.ok(pkg.scripts.verify.trim(), "verify must not be empty");
  for (const script of ["preinstall", "install", "postinstall", "prepare", "preverify", "postverify"]) {
    assert.equal(pkg.scripts[script], undefined, `${script}: implicit execution is not allowed`);
  }
  assert.equal(pkg.workspaces, undefined, "workspace installation requires a reviewed execution contract");
  assert.equal(lock.lockfileVersion, 3, "lockfile v3 is required");
  assert.equal(lock.name, pkg.name, "lockfile name mismatch");
  assert.equal(lock.version, pkg.version, "lockfile version mismatch");
  assert.ok(lock.packages?.[""], "lockfile root is required");
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    assert.deepEqual(lock.packages[""][field] ?? {}, pkg[field] ?? {}, `${field}: package/lock mismatch`);
    for (const version of Object.values(pkg[field] ?? {})) {
      assert.match(version, /^\d+\.\d+\.\d+$/, "direct dependencies must use exact registry versions");
    }
  }
  for (const [path, dependency] of Object.entries(lock.packages)) {
    if (path === "") continue;
    assert.ok(path.startsWith("node_modules/") && !path.split("/").includes(".."), "invalid dependency path");
    assert.equal(dependency.link, undefined, "linked dependencies are not allowed");
    assert.equal(dependency.hasInstallScript, undefined, "dependency installation scripts are not allowed");
    const url = new URL(dependency.resolved);
    assert.equal(url.origin, "https://registry.npmjs.org", "dependencies must come from the npm registry");
    assert.equal(url.username + url.password + url.search + url.hash, "", "dependency URL authority override");
    assert.match(dependency.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, "dependency integrity is required");
  }
  return { pkg, lock };
}

export function validateMergePolicy(policy) {
  assert.equal(policy.merge_method, "squash");
  assert.equal(policy.merge_queue, false);
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.deepEqual(policy.eligible_bot_logins, ["dependabot[bot]"]);
  assert.ok(policy.required_checks?.some((check) =>
    check.context === "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required" &&
    check.integration_id === 15368), "trusted required check must remain enforced");
  assert.equal(policy.sensitive_review?.enforcement, "github_environment");
  assert.equal(policy.sensitive_review.environment, "coffee-security");
  assert.equal(policy.sensitive_review.required_approvals, 1);
  assert.ok(Array.isArray(policy.protected_paths) && policy.protected_paths.length > 0);
  for (const path of policy.protected_paths) {
    assert.equal(typeof path, "string");
    assert.ok(path.length > 0 && !path.startsWith("!") && !/[\r\n\0]/u.test(path), "invalid protected path");
  }
  const normalized = policy.protected_paths.map((path) => path.replace(/^\//u, ""));
  for (const path of [".github/**", "AGENTS.md", "CODEOWNERS", "package.json", "package-lock.json"]) {
    assert.ok(normalized.includes(path), `protected control missing: ${path}`);
  }
}

export function validateCandidatePolicy(baseRoot, candidateRoot) {
  // No repository code, YAML constructors, package imports or base bootstrap is executed here.
  const records = execFileSync("git", ["-C", candidateRoot, "ls-files", "--stage", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const record of records) {
    const [metadata, path] = record.split("\t");
    assert.match(metadata, /^100(?:644|755) [0-9a-f]{40} 0$/, `${path}: only regular tracked files are allowed`);
    assert.ok(lstatSync(resolve(candidateRoot, path)).isFile(), `${path}: checkout must be regular`);
    assert.ok(!/(^|\/)(?:\.npmrc|npm-shrinkwrap\.json|\.gitleaks\.toml)$/u.test(path), `${path}: alternate authority is forbidden`);
  }
  const base = readJson(baseRoot, ".github/merge-policy.json");
  const candidate = readJson(candidateRoot, ".github/merge-policy.json");
  validateMergePolicy(base);
  validateMergePolicy(candidate);
  const normalized = new Set(candidate.protected_paths.map((path) => path.replace(/^\//u, "")));
  for (const path of base.protected_paths) {
    assert.ok(normalized.has(path.replace(/^\//u, "")), `protected path removal requires a scoped exception: ${path}`);
  }
  for (const check of base.required_checks) {
    assert.ok(candidate.required_checks.some((entry) => entry.context === check.context && entry.integration_id === check.integration_id), "required check removal is forbidden");
  }
  assert.ok((candidate.required_approvals ?? 0) >= (base.required_approvals ?? 0), "review requirement cannot decrease");
  assert.ok((candidate.required_code_owner_reviews ?? 0) >= (base.required_code_owner_reviews ?? 0), "code-owner review cannot decrease");
  if (base.sensitive_review.prevent_self_review === true) assert.equal(candidate.sensitive_review.prevent_self_review, true);
  assert.deepEqual(readdirSync(resolve(candidateRoot, ".github/workflows")).sort(), ["trusted.yml"], "only the inert wrapper is allowed");
  validateCandidateWorkflowDelegation(readFileSync(resolve(candidateRoot, ".github/workflows/trusted.yml"), "utf8"));
  // Preserve installed local safeguards while policy implementation moves to the center.
  for (const path of [".githooks/pre-commit", ".github/dependabot.yml"]) {
    assert.equal(readFileSync(resolve(candidateRoot, path), "utf8"), readFileSync(resolve(baseRoot, path), "utf8"), `${path}: control evolution requires a separately reviewed central contract`);
  }
  assert.ok(lstatSync(resolve(candidateRoot, ".githooks/pre-commit")).mode & 0o111, "secret hook must remain executable");
  const ignore = (root) => readFileSync(resolve(root, ".gitignore"), "utf8").split("\n").filter((line) => line && !line.startsWith("#"));
  const baseIgnore = ignore(baseRoot);
  const candidateIgnore = ignore(candidateRoot);
  for (const pattern of baseIgnore) assert.ok(candidateIgnore.includes(pattern), `.gitignore removed protection: ${pattern}`);
  for (const pattern of candidateIgnore.filter((line) => line.startsWith("!"))) assert.ok(baseIgnore.includes(pattern), ".gitignore cannot add exclusion overrides");
  const ownerPath = existsSync(resolve(baseRoot, ".github/CODEOWNERS")) ? ".github/CODEOWNERS" : "CODEOWNERS";
  const owners = (root) => readFileSync(resolve(root, ownerPath), "utf8").split("\n").filter((line) => line.trim() && !line.startsWith("#")).map((line) => line.trim().split(/\s+/u));
  const candidateOwners = owners(candidateRoot);
  for (const [pattern, ...reviewers] of owners(baseRoot)) {
    const matches = candidateOwners.filter(([path]) => path === pattern);
    assert.equal(matches.length, 1, "ownership routes cannot be missing or shadowed");
    for (const reviewer of reviewers) assert.ok(matches[0].slice(1).includes(reviewer), `owner removed for ${pattern}`);
  }
  for (const path of ["AGENTS.md", "SECURITY.md"]) assert.ok(readFileSync(resolve(candidateRoot, path), "utf8").trim(), `${path} must remain nonempty`);
  validatePackage(candidateRoot);
  return { status: "policy-passed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(validateCandidatePolicy(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(`Policy violation or invalid control data: ${error.message}`);
    process.exitCode = 1;
  }
}
