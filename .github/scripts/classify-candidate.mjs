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

function requireNoCandidateWorkflows(candidateRoot) {
  const workflowRoot = resolve(candidateRoot, ".github/workflows");
  if (!existsSync(workflowRoot)) return;
  const workflows = readdirSync(workflowRoot).filter((name) => /\.ya?ml$/u.test(name));
  if (workflows.length > 0) {
    throw new Error(
      `target repositories must delegate automatic workflows to organization controls: ${workflows.join(",")}`,
    );
  }
}

export function classifyCandidate({
  baseSha,
  candidateRoot,
  exactPolicyOutcome,
  headSha,
  trustedRoot,
}) {
  requireNoCandidateWorkflows(candidateRoot);
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
  const sensitive = exactPolicyOutcome !== "success" || protectedChanges.length > 0;
  return Object.freeze({
    sensitive,
    protectedChanges: Object.freeze(protectedChanges),
    changedPathCount: paths.length,
  });
}

function main() {
  const result = classifyCandidate({
    baseSha: process.env.BASE_SHA,
    candidateRoot: process.env.CANDIDATE_ROOT,
    exactPolicyOutcome: process.env.EXACT_POLICY_OUTCOME,
    headSha: process.env.HEAD_SHA,
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
