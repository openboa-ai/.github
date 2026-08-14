import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CHANGED_PATH_BYTES = 4 * 1024 * 1024;
const MAX_CHANGED_PATHS = 10_000;

function globPattern(pattern) {
  let normalized = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`, "u");
}

function changedPaths(candidateRoot, baseSha, headSha) {
  const output = execFileSync(
    "git",
    [
      "-C",
      candidateRoot,
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      baseSha,
      headSha,
    ],
    { encoding: "utf8", maxBuffer: MAX_CHANGED_PATH_BYTES },
  );
  const paths = output.split("\0").filter(Boolean);
  if (paths.length > MAX_CHANGED_PATHS) {
    throw new Error("candidate changes exceed the trusted path budget");
  }
  return paths;
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

export function validateCandidateWorkflowDelegation(source) {
  if (typeof source !== "string" || source.length > 16 * 1024) {
    throw new Error("target repository must retain the exact trusted wrapper");
  }
  const match = source.match(
    /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@([0-9a-f]{40})/u,
  );
  const controlSha = match?.[1];
  if (controlSha === undefined || source !== trustedWrapper(controlSha)) {
    throw new Error("target repository must retain the exact trusted wrapper");
  }
  return controlSha;
}

function requireTrustedCandidateWorkflow(candidateRoot) {
  const workflowRoot = resolve(candidateRoot, ".github/workflows");
  if (!existsSync(workflowRoot)) {
    throw new Error("target repository must retain the exact trusted wrapper");
  }
  const entries = readdirSync(workflowRoot).sort();
  if (entries.length !== 1 || entries[0] !== "trusted.yml") {
    throw new Error("target repository must retain the exact trusted wrapper");
  }
  validateCandidateWorkflowDelegation(
    readFileSync(resolve(workflowRoot, "trusted.yml"), "utf8"),
  );
}

export function classifyCandidate({
  actor,
  baseRepository,
  baseSha,
  candidateRoot,
  exactPolicyOutcome,
  headRepository,
  headSha,
  prAuthor,
  trustedRoot,
}) {
  requireTrustedCandidateWorkflow(candidateRoot);
  const policy = JSON.parse(
    readFileSync(resolve(trustedRoot, ".github/merge-policy.json"), "utf8"),
  );
  if (!Array.isArray(policy.protected_paths) || policy.protected_paths.length === 0) {
    throw new Error("trusted merge policy must define protected paths");
  }
  const matchers = policy.protected_paths.map((pattern) => {
    if (typeof pattern !== "string" || pattern.startsWith("!")) {
      throw new Error("trusted protected paths must be positive string patterns");
    }
    return globPattern(pattern);
  });
  const paths = changedPaths(candidateRoot, baseSha, headSha);
  const protectedChanges = paths.filter((path) =>
    matchers.some((matcher) => matcher.test(path)),
  );
  const dependabotPackageOnly =
    exactPolicyOutcome === "success" &&
    actor === "dependabot[bot]" &&
    prAuthor === "dependabot[bot]" &&
    typeof baseRepository === "string" &&
    baseRepository.length > 0 &&
    headRepository === baseRepository &&
    protectedChanges.length > 0 &&
    protectedChanges.every(
      (path) => path === "package.json" || path === "package-lock.json",
    );
  const sensitive =
    exactPolicyOutcome !== "success" ||
    (protectedChanges.length > 0 && !dependabotPackageOnly);
  return Object.freeze({
    sensitive,
    protectedChanges: Object.freeze(protectedChanges),
    changedPathCount: paths.length,
  });
}

function main() {
  const result = classifyCandidate({
    actor: process.env.ACTOR,
    baseRepository: process.env.BASE_REPOSITORY,
    baseSha: process.env.BASE_SHA,
    candidateRoot: process.env.CANDIDATE_ROOT,
    exactPolicyOutcome: process.env.EXACT_POLICY_OUTCOME,
    headRepository: process.env.HEAD_REPOSITORY,
    headSha: process.env.HEAD_SHA,
    prAuthor: process.env.PR_AUTHOR,
    trustedRoot: process.env.TRUSTED_ROOT,
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `sensitive=${result.sensitive ? "true" : "false"}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ status: "classified", ...result })}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
