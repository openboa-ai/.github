import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { classifyCandidate, trustedWrapper, validateCandidateWorkflowDelegation } from "../.github/scripts/classify-candidate.mjs";
import { validateCandidatePolicy, validatePackage } from "../.github/scripts/check-candidate-policy.mjs";
import { checkCodeqlSarif } from "../.github/scripts/check-codeql-sarif.mjs";
import { checkRequiredResults } from "../.github/scripts/check-required-results.mjs";
import { containerArgs, IMAGE, repositorySnapshot } from "../.github/scripts/run-repository-verify.mjs";
import { auditSettings } from "../.github/scripts/audit-ci-settings.mjs";

const source = resolve(import.meta.dirname, "..");
const workflow = readFileSync(join(source, ".github/workflows/coffee-trusted-gate.yml"), "utf8");
const baselineWorkflow = readFileSync(join(source, ".github/workflows/repository-baseline.yml"), "utf8");
const write = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
const json = (root, path, data) => write(root, path, JSON.stringify(data, null, 2) + "\n");
const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });

function baselineScript(name) {
  const step = baselineWorkflow.split(`      - name: ${name}\n`)[1]?.split("      - name:")[0];
  assert.ok(step, `Missing baseline step: ${name}`);
  const script = step.match(/        run: \|\n([\s\S]*)/u)?.[1];
  assert.ok(script, `Missing baseline run block: ${name}`);
  return script.trimEnd().split("\n").map((line) => line.slice(10)).join("\n");
}

test("reusable baseline has no caller-supplied authority or candidate execution", () => {
  assert.equal(baselineWorkflow.match(/^on:\n([\s\S]*?)\npermissions:/mu)[1], "  workflow_call:\n");
  assert.match(baselineWorkflow, /\n  baseline:\n    name: Trusted repository baseline\n/u);
  assert.match(baselineWorkflow, /permissions: \{\}[\s\S]*?permissions:\n      contents: read\n/u);
  assert.doesNotMatch(baselineWorkflow, /\binputs:|\boutputs:|\bsecrets:|continue-on-error|\bwrite\b|\benvironment:|working-directory: candidate|(?:node|bash|sh|python) candidate\//u);
  assert.equal((baselineWorkflow.match(/persist-credentials: false/gu) || []).length, 2);
  assert.match(baselineWorkflow, /repository: openboa-ai\/\.github\n          ref: 700dacb7d811a080cb49bb4a81a9d5f437d697fd/u);
  for (const match of baselineWorkflow.matchAll(/uses: ([^\s]+)/gu)) assert.match(match[1], /@[0-9a-f]{40}$/u);
});

test("baseline event admission rejects unsupported or incomplete authority", () => {
  const valid = {
    EVENT_NAME: "pull_request", REPOSITORY: "openboa-ai/example", REF_NAME: "refs/pull/3/merge",
    PR_BASE_REPOSITORY: "openboa-ai/example", PR_HEAD_REPOSITORY: "contributor/example",
    HEAD_SHA: "a".repeat(40), BASE_SHA: "b".repeat(40),
  };
  for (const [override, allowed] of [
    [{}, true], [{ EVENT_NAME: "push", REF_NAME: "refs/heads/main" }, true],
    [{ EVENT_NAME: "push", REF_NAME: "refs/heads/main", BASE_SHA: "0".repeat(40) }, true],
    [{ EVENT_NAME: "workflow_dispatch" }, false], [{ EVENT_NAME: "pull_request_target" }, false],
    [{ EVENT_NAME: "push", REF_NAME: "refs/heads/topic" }, false],
    [{ PR_BASE_REPOSITORY: "another/repository" }, false], [{ PR_HEAD_REPOSITORY: "" }, false],
    [{ REPOSITORY: "../../tmp" }, false], [{ HEAD_SHA: "refs/heads/main" }, false],
    [{ HEAD_SHA: "" }, false], [{ HEAD_SHA: "0".repeat(40) }, false],
    [{ BASE_SHA: "" }, false], [{ BASE_SHA: "0".repeat(40) }, false],
  ]) {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", baselineScript("Admit exact event context")], {
      env: { PATH: process.env.PATH, ...valid, ...override }, encoding: "utf8",
    });
    assert.equal(result.status === 0, allowed, JSON.stringify(override) + result.stderr);
  }
});

test("baseline lint covers all extensions and cannot inherit candidate ignore configuration", () => {
  const script = baselineScript("Validate all candidate workflows with trusted configuration");
  const stub = 'actionlint() { test "$1" = -config-file; test "$(cat "$2")" = "{}"; shift 2; printf "%s\\0" "$@"; return "$LINT_STATUS"; }\n';
  for (const files of [["existing.yml", "new workflow.yaml", ".hidden.yaml"], ["only.yml"], ["only.yaml"], []]) {
    const root = mkdtempSync(join(tmpdir(), "baseline-lint-"));
    try {
      const paths = files.map((file) => "candidate/.github/workflows/" + file);
      for (const path of paths) write(root, path, "on: push\n");
      write(root, "candidate/.github/actionlint.yaml", "paths:\n  '**':\n    ignore: ['.*']\n");
      for (const status of [0, 23]) {
        const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stub + script], {
          cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: root, LINT_STATUS: String(status) }, encoding: "utf8",
        });
        if (files.length === 0) { assert.notEqual(result.status, 0); assert.equal(result.stdout, ""); }
        else {
          assert.equal(result.status, status, result.stderr);
          assert.deepEqual(result.stdout.split("\0").slice(0, -1).sort(), ["-shellcheck=", "-pyflakes=", ...paths].sort());
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("baseline diff binds the checked-out head and validates initial and subsequent commits", () => {
  const root = mkdtempSync(join(tmpdir(), "baseline-diff-"));
  const candidate = join(root, "candidate");
  try {
    mkdirSync(candidate);
    git(candidate, "init", "--initial-branch=main");
    git(candidate, "config", "user.name", "Fixture");
    git(candidate, "config", "user.email", "fixture@example.invalid");
    write(candidate, "README.md", "Baseline\n");
    git(candidate, "add", "."); git(candidate, "commit", "-m", "initial");
    const base = git(candidate, "rev-parse", "HEAD").trim();
    const run = (head, before, event = "pull_request") => spawnSync("bash", ["-e", "-o", "pipefail", "-c",
      // Network retrieval is deliberately stubbed; local commit validation is real.
      'git() { if test "$3" = fetch; then return 42; fi; command git "$@"; }\n' + baselineScript("Verify candidate identity and whitespace")], {
      cwd: root, env: { PATH: process.env.PATH, HEAD_SHA: head, BASE_SHA: before, EVENT_NAME: event, REPOSITORY: "openboa-ai/example" }, encoding: "utf8",
    });
    assert.equal(run(base, "0".repeat(40), "push").status, 0);
    write(candidate, "README.md", "Baseline\nClean change\n");
    git(candidate, "add", "."); git(candidate, "commit", "-m", "clean");
    const clean = git(candidate, "rev-parse", "HEAD").trim();
    assert.equal(run(clean, base).status, 0);
    assert.equal(run(clean, base, "push").status, 0);
    assert.notEqual(run(base, base).status, 0);
    assert.equal(run(clean, "f".repeat(40)).status, 42);
    write(candidate, "README.md", "Baseline\nBad whitespace \n");
    write(candidate, ".gitattributes", "* -whitespace\n");
    git(candidate, "add", "."); git(candidate, "commit", "-m", "whitespace with candidate override");
    const bad = git(candidate, "rev-parse", "HEAD").trim();
    assert.notEqual(run(bad, base).status, 0);
    assert.notEqual(run(bad, "0".repeat(40), "push").status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("baseline secret scans use trusted config and propagate both failures", () => {
  const script = baselineScript("Scan candidate history and files with trusted configuration");
  const stub = `gitleaks() {
    mode="$1"; shift
    test "$*" = '--config /trusted/gitleaks.toml --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow --redact --no-banner candidate' || return 91
    printf '%s\\n' "$mode"
    if test "$mode" = "$FAIL_MODE"; then return 29; fi
  }\n`;
  for (const [mode, status, calls] of [["none", 0, "git\ndir\n"], ["git", 29, "git\n"], ["dir", 29, "git\ndir\n"]]) {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stub + script], {
      env: { PATH: process.env.PATH, GITLEAKS_TRUSTED_CONFIG: "/trusted/gitleaks.toml", FAIL_MODE: mode }, encoding: "utf8",
    });
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stdout, calls);
  }
});

test("baseline whitespace rejects changes hidden by binary diff attributes", () => {
  for (const attributes of ["* -diff -whitespace", "* binary -whitespace"]) {
    const root = mkdtempSync(join(tmpdir(), "baseline-binary-attributes-"));
    const candidate = join(root, "candidate");
    try {
      mkdirSync(candidate);
      git(candidate, "init", "--initial-branch=main");
      git(candidate, "config", "user.name", "Fixture");
      git(candidate, "config", "user.email", "fixture@example.invalid");
      write(candidate, ".gitattributes", attributes + "\n");
      write(candidate, "nested/file.txt", "Clean line\n");
      git(candidate, "add", "."); git(candidate, "commit", "-m", "initial");
      const base = git(candidate, "rev-parse", "HEAD").trim();
      write(candidate, "nested/.gitattributes", attributes + "\n");
      write(candidate, "nested/file.txt", "Trailing whitespace \n");
      git(candidate, "add", "."); git(candidate, "commit", "-m", "candidate binary override");
      const head = git(candidate, "rev-parse", "HEAD").trim();
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", baselineScript("Verify candidate identity and whitespace")], {
        cwd: root, env: { PATH: process.env.PATH, HEAD_SHA: head, BASE_SHA: base, EVENT_NAME: "pull_request", REPOSITORY: "openboa-ai/example" }, encoding: "utf8",
      });
      assert.notEqual(result.status, 0, attributes + " suppressed the whitespace check");
      assert.match(result.stdout + result.stderr, /trailing whitespace/iu);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("historical fixture exception is repository-, object- and digest-bound and history-only", () => {
  const start = workflow.indexOf("          # Known historical synthetic fixture,");
  const end = workflow.indexOf("          gitleaks git --config", start);
  assert.ok(start > 0 && end > start);
  const script = workflow.slice(start, end).split("\n").map((line) => line.slice(10)).join("\n");
  const object = "fde3ff7cb1b15e85a31439588e7fa1a6252717ae:tests/runner.test.ts";
  const digest = "c1f776ddc7450d3f483cc2011881bef245939601aa74ba8e7dd495f5b94042ea";
  // Shell boundary tests stub Git and hashing; these are not scanner integration tests.
  const stubs = `git() {
    test "$*" = "-C candidate cat-file -e $EXPECTED_OBJECT" && return "$OBJECT_STATUS"
    test "$*" = "-C candidate cat-file blob $EXPECTED_OBJECT" || return 97
    printf '%s' inert
  }
  sha256sum() { cat >/dev/null; printf '%s  -\\n' "$TEST_DIGEST"; }
  history_ignore_path="$TRUSTED_IGNORE"
  ignore_path="$TRUSTED_IGNORE"
  `;
  const root = mkdtempSync(join(tmpdir(), "coffee-history-scope-"));
  try {
    const baseline = join(root, "trusted.ignore");
    writeFileSync(baseline, "# pre-existing trusted policy\n");
    for (const [repository, status, hash, expected] of [
      ["openboa-ai/coffee-chat-eval", "0", digest, "scoped"],
      ["openboa-ai/coffee-chat", "0", digest, "unchanged"],
      ["outsider/coffee-chat-eval", "0", digest, "unchanged"],
      ["openboa-ai/coffee-chat-eval", "1", digest, "unchanged"],
      ["openboa-ai/coffee-chat-eval", "0", "0".repeat(64), "failure"],
    ]) {
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", stubs + script + '\nprintf "%s\\n%s" "$history_ignore_path" "$ignore_path"'], {
        env: { PATH: process.env.PATH, RUNNER_TEMP: root, BASE_REPOSITORY: repository, EXPECTED_OBJECT: object, OBJECT_STATUS: status, TEST_DIGEST: hash, TRUSTED_IGNORE: baseline }, encoding: "utf8",
      });
      if (expected === "failure") { assert.notEqual(result.status, 0); continue; }
      assert.equal(result.status, 0, result.stderr);
      const [history, current] = result.stdout.split("\n");
      assert.equal(current, baseline);
      assert.equal(readFileSync(baseline, "utf8"), "# pre-existing trusted policy\n");
      if (expected === "unchanged") assert.equal(history, baseline);
      else {
        assert.notEqual(history, baseline);
        assert.equal(readFileSync(history, "utf8"), "# pre-existing trusted policy\n\n" + object + ":github-pat:170\n");
      }
    }
    const scans = workflow.slice(end, workflow.indexOf("      - name: Set up Node.js", end));
    assert.equal((scans.match(/--gitleaks-ignore-path "\$history_ignore_path"/gu) || []).length, 1);
    assert.equal((scans.match(/--gitleaks-ignore-path "\$ignore_path"/gu) || []).length, 2);
    assert.equal((scans.match(/--ignore-gitleaks-allow/gu) || []).length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
      protected_paths: ["/.github/**", "/AGENTS.md", "/SECURITY.md", "/CODEOWNERS", "/package.json", "/package-lock.json", "/data/**"],
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
test("security policy protection is mandatory in both trusted and candidate policies", () => {
  for (const scope of ["both", "base", "candidate"]) for (const replacement of [undefined, "/security.md", "/docs/SECURITY.md", "./SECURITY.md", "//SECURITY.md"]) fixture(({ base, candidate, policy }) => {
    policy.protected_paths = policy.protected_paths.filter((path) => path !== "/SECURITY.md");
    if (replacement !== undefined) policy.protected_paths.push(replacement);
    for (const root of scope === "both" ? [base, candidate] : [scope === "base" ? base : candidate]) json(root, ".github/merge-policy.json", policy);
    git(candidate, "add", "-f", "--all");
    assert.throws(() => validateCandidatePolicy(base, candidate), /protected control missing: SECURITY\.md/u);
  });
});
test("root security policy edits remain sensitive with either supported path spelling", () => {
  for (const path of ["SECURITY.md", "/SECURITY.md"]) fixture(({ base, candidate, baseSha: initialBaseSha, policy }) => {
    policy.protected_paths = policy.protected_paths.map((entry) => entry === "/SECURITY.md" ? path : entry);
    for (const root of [base, candidate]) json(root, ".github/merge-policy.json", policy);
    const baseSha = path === "/SECURITY.md" ? initialBaseSha : commit(candidate);
    write(candidate, "SECURITY.md", "Changed security guidance.\n");
    const headSha = commit(candidate);
    assert.equal(validateCandidatePolicy(base, candidate).status, "policy-passed");
    for (const actor of ["owner", "dependabot[bot]"]) {
      const result = classifyCandidate({ baseRepository: "openboa-ai/coffee-chat", headRepository: "openboa-ai/coffee-chat", actor, prAuthor: actor, trustedRoot: base, candidateRoot: candidate, baseSha, headSha });
      assert.equal(result.sensitive, true);
      assert.deepEqual(result.protectedChanges, ["SECURITY.md"]);
    }
  });
});
test("the PR-only wrapper is structurally exact and SHA-updatable", () => {
  for (const sha of ["a".repeat(40), "b".repeat(40)]) assert.equal(validateCandidateWorkflowDelegation(trustedWrapper(sha)), sha);
  for (const mutate of [
    (s) => s.replace("contents: read", "contents: write"),
    (s) => s.replace("control_sha: " + "a".repeat(40), "control_sha: " + "b".repeat(40)),
    (s) => s + "    steps:\n      - run: echo spoof\n",
    (s) => s.replace("pull_request_target:", "pull_request:"),
    (s) => s.replace("\n\npermissions: {}", "\n  push:\n    branches: [main]\n\npermissions: {}"),
  ]) assert.throws(() => validateCandidateWorkflowDelegation(mutate(trustedWrapper("a".repeat(40)))));
});
test("target trigger expansion fails policy and classification before approval", () => {
  for (const trigger of ["  push:\n    branches: [main]\n", "  workflow_dispatch: {}\n", "  schedule:\n    - cron: '0 0 * * *'\n"]) fixture(({ base, candidate, baseSha }) => {
    const expanded = trustedWrapper("a".repeat(40)).replace("\n\npermissions: {}", "\n" + trigger + "\npermissions: {}");
    write(candidate, ".github/workflows/trusted.yml", expanded);
    const headSha = commit(candidate);
    assert.throws(() => validateCandidatePolicy(base, candidate), /exact trusted wrapper/u);
    assert.throws(() => classifyCandidate({ baseRepository: "openboa-ai/coffee-chat", headRepository: "openboa-ai/coffee-chat", actor: "owner", prAuthor: "owner", trustedRoot: base, candidateRoot: candidate, baseSha, headSha }), /exact trusted wrapper/u);
  });
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
test("ownership precedence, competing locations and unloaded files cannot remove review routes", () => {
  for (const mutate of [
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner\n* @other\n"),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner\n/.github/workflows/** @other\n"),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner\n/.github/workflows/**\n"),
    ({ candidate }) => write(candidate, ".github/CODEOWNERS", "* @other\n"),
    ({ candidate }) => write(candidate, "docs/CODEOWNERS", "* @other\n"),
    ({ base, candidate }) => {
      write(base, "CODEOWNERS", "* @global\n/.github/** @owner\n");
      write(candidate, "CODEOWNERS", "/.github/** @owner\n* @global\n");
    },
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner\n#" + "x".repeat(3_000_000)),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @other # @owner\n"),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner docs@\n"),
    ({ candidate }) => write(candidate, "CODEOWNERS", "/.github/** @owner @invalid--login\n"),
  ]) fixture((f) => {
    mutate(f); git(f.candidate, "add", "-f", "--all");
    assert.throws(() => validateCandidatePolicy(f.base, f.candidate));
  });
});
test("ownership preserves ordered routes and supports maintainer additions and GitHub locations", () => {
  for (const path of ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"]) fixture(({ base, candidate }) => {
    if (path !== "CODEOWNERS") for (const root of [base, candidate]) rmSync(join(root, "CODEOWNERS"));
    write(base, path, "* @global\n/.github/** @owner\n");
    write(candidate, path, "  # Review routes\r\n*\t@global @maintainer\r\n/.github/** @owner @maintainer # owners retained\r\n");
    git(candidate, "add", "-f", "--all");
    assert.equal(validateCandidatePolicy(base, candidate).status, "policy-passed");
  });
  fixture(({ base, candidate }) => {
    write(candidate, "CODEOWNERS", "/new-file.md @maintainer\n/.github/** @owner\n");
    git(candidate, "add", "-f", "--all");
    assert.equal(validateCandidatePolicy(base, candidate).status, "policy-passed");
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
test("Dependabot exact patch/minor bumps stay routine while major/range/downgrade changes stay sensitive", () => {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [version, sensitive] of [["1.2.4", false], ["1.3.0", false], ["2.0.0", true], ["1.2.2", true], ["1.1.9", true], ["^1.2.4", true]]) fixture(({ base, candidate }) => {
      const pkg = JSON.parse(readFileSync(join(base, "package.json")));
      pkg[field] = { dependency: "1.2.3" };
      json(base, "package.json", pkg); json(candidate, "package.json", pkg);
      const baseSha = commit(candidate);
      pkg[field].dependency = version;
      json(candidate, "package.json", pkg);
      const headSha = commit(candidate);
      const options = { baseRepository: "openboa-ai/coffee-chat", headRepository: "openboa-ai/coffee-chat", actor: "dependabot[bot]", prAuthor: "dependabot[bot]", trustedRoot: base, candidateRoot: candidate, baseSha, headSha };
      assert.equal(classifyCandidate(options).sensitive, sensitive, `${field}: ${version}`);
      if (!sensitive) {
        assert.equal(classifyCandidate({ ...options, actor: "owner" }).sensitive, true);
        assert.equal(classifyCandidate({ ...options, prAuthor: "owner" }).sensitive, true);
        assert.equal(classifyCandidate({ ...options, headRepository: "outsider/coffee-chat" }).sensitive, true);
      }
    });
  }
});
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
test("snapshot cannot hide archive attributes behind Git-quoted names", () => {
  for (const directory of ["tést", "한글", "tab\tpath", "line\npath", 'quote"path', "back\\slash"]) {
    for (const attribute of ["export-ignore", "export-subst"]) fixture(({ candidate }) => {
      const path = `${directory}/reviewed.txt`;
      write(candidate, path, "$Format:%H$\n");
      write(candidate, `${directory}/.gitattributes`, `reviewed.txt ${attribute}\n`);
      commit(candidate);
      if (directory === "tést" && attribute === "export-ignore") {
        const archive = execFileSync("git", ["-C", candidate, "archive", "--format=tar", git(candidate, "write-tree").trim()]);
        assert.ok(git(candidate, "ls-tree", "-r", "-z", "--name-only", "HEAD").split("\0").includes(path));
        assert.notEqual(spawnSync("tar", ["-xOf", "-", path], { input: archive }).status, 0, "unguarded archive omits the reviewed file");
      }
      assert.throws(() => repositorySnapshot(candidate), /archive transformations are not allowed/u, JSON.stringify(directory));
    });
    for (const authority of [".npmrc", "npm-shrinkwrap.json"]) fixture(({ candidate }) => {
      write(candidate, `${directory}/${authority}`, "untrusted\n");
      commit(candidate);
      assert.throws(() => repositorySnapshot(candidate), /alternate installation authority/u, JSON.stringify(directory));
    });
  }
});
test("snapshot preserves ordinary Unicode and control-character filenames", () => fixture(({ candidate }) => {
  for (const path of ["한글/문서.txt", "tést/note.txt", "tab\tpath/note.txt", "line\npath/note.txt"]) write(candidate, path, "reviewed\n");
  const comments = "# harmless comment\n".repeat(60_000);
  write(candidate, "tést/.gitattributes", comments + "note.txt -text\n");
  commit(candidate);
  const snapshot = repositorySnapshot(candidate);
  assert.equal(snapshot.tree, git(candidate, "write-tree").trim());
  for (const path of ["한글/문서.txt", "tést/note.txt", "tab\tpath/note.txt", "line\npath/note.txt"]) {
    assert.equal(execFileSync("tar", ["-xOf", "-", path], { input: snapshot.archive, encoding: "utf8" }), "reviewed\n");
  }
  write(candidate, "tést/.gitattributes", comments + "note.txt export-ignore\n");
  commit(candidate);
  assert.throws(() => repositorySnapshot(candidate), /archive transformations are not allowed/u);
}));
test("snapshot checks raw non-UTF8 path bytes without lossy decoding", { skip: process.platform !== "linux" }, () => {
  for (const basename of [".gitattributes", ".npmrc", "npm-shrinkwrap.json"]) fixture(({ candidate }) => {
    const directory = Buffer.concat([Buffer.from(candidate + "/raw-"), Buffer.from([0xff])]);
    mkdirSync(directory);
    writeFileSync(Buffer.concat([directory, Buffer.from("/" + basename)]), "* export-ignore\n");
    commit(candidate);
    assert.throws(() => repositorySnapshot(candidate), basename === ".gitattributes" ? /archive transformations/u : /alternate installation authority/u);
  });
});
test("workflow preserves trusted scans and approval ordering without product coupling", () => {
  for (const pattern of [/gitleaks git/u, /git -C candidate cat-file blob/u, /dependency-review-action@[0-9a-f]{40}/u, /build-mode: none/u, /check-codeql-sarif.mjs/u, /environment: coffee-security/u, /needs\.sensitive-review\.result == 'success'/u, /run-repository-verify.mjs/u]) assert.match(workflow, pattern);
  assert.doesNotMatch(workflow, /continue-on-error|exact-policy|policy-bootstrap|ci-policy.mjs|run-candidate-quality|harbor/u);
  for (const match of workflow.matchAll(/uses: ([^\s]+)/gu)) assert.match(match[1], /@[0-9a-f]{40}$/u);
  assert.doesNotMatch(readFileSync(join(source, ".github/scripts/check-candidate-policy.mjs"), "utf8"), /skills\/|evals\/|iterations\/|perspective-capture|development\/|policy-parser/u);
});
test("central PR orchestration stays base-owned without a candidate bootstrap", () => {
  // Regression coverage, not a GitHub pre-execution policy barrier.
  assert.deepEqual(readdirSync(join(source, ".github/workflows")).filter((file) => /\.ya?ml$/u.test(file)).sort(), ["ci.yml", "coffee-trusted-gate.yml", "repository-baseline.yml"]);
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  assert.equal(trusted.match(/^on:\n([\s\S]*?)\npermissions:/mu)[1], "  pull_request_target:\n    types: [opened, synchronize, reopened, ready_for_review]\n  push:\n    branches: [main]\n");
  assert.match(trusted, /name: Organization controls verification/u);
  assert.match(trusted, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}[\s\S]*?path: control/u);
  assert.match(trusted, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}[\s\S]*?path: candidate/u);
  assert.match(trusted, /node control\/\.github\/scripts\/run-repository-verify\.mjs/u);
  assert.doesNotMatch(trusted, /  pull_request:|node candidate\/|bash candidate\/|working-directory: candidate|continue-on-error/u);
  for (const match of trusted.matchAll(/uses: ([^\s]+)/gu)) assert.match(match[1], /@[0-9a-f]{40}$/u);
  assert.match(workflow, /^on:\n  workflow_call:\n/mu);
});
test("actual lint step includes both workflow extensions and propagates failures", () => {
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  const block = trusted.slice(trusted.indexOf("      - name: Validate candidate workflows as data"), trusted.indexOf("      - name: Install trusted secret scanner"));
  const run = block.match(/        run: ([\s\S]*)/u)[1].trimEnd();
  const script = run.startsWith("|\n") ? run.slice(2).split("\n").map((line) => line.slice(10)).join("\n") : run;
  const capture = "actionlint() { printf '%s\\0' \"$@\"; return \"$LINT_STATUS\"; }\n";
  for (const files of [["existing.yml", "new workflow.yaml", ".hidden.yaml"], ["only.yml"], ["only.yaml"], []]) {
    const root = mkdtempSync(join(tmpdir(), "coffee-workflow-lint-"));
    try {
      const paths = files.map((file) => "candidate/.github/workflows/" + file);
      for (const path of paths) write(root, path, "on: push\n");
      write(root, "candidate/.github/workflows/README.md", "Not a workflow.\n");
      for (const status of [0, 23]) {
        const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", capture + script], { cwd: root, env: { PATH: process.env.PATH, LINT_STATUS: String(status) }, encoding: "utf8" });
        if (files.length === 0) {
          assert.notEqual(result.status, 0);
          assert.equal(result.stdout, "");
        } else {
          assert.equal(result.status, status, result.stderr);
          assert.deepEqual(result.stdout.split("\0").slice(0, -1).sort(), ["-shellcheck=", "-pyflakes=", ...paths].sort());
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
test("central CodeQL remains inert, base-controlled and attributed to the exact candidate", () => {
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  const scanner = trusted.slice(trusted.indexOf("\n  codeql:\n"), trusted.indexOf("\n  required:\n"));
  assert.match(scanner, /needs: verify/u);
  assert.match(scanner, /fail-fast: false\n      matrix:\n        language: \[javascript-typescript, actions\]/u);
  assert.match(scanner, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.sha \}\}/u);
  assert.match(scanner, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}\n          persist-credentials: false\n          clean: true/u);
  assert.doesNotMatch(scanner, /\n          path:/u);
  assert.match(scanner, /bash "\$TRUSTED_CONTROLS\/reject-candidate-authorities\.sh" "\$GITHUB_WORKSPACE"/u);
  assert.match(scanner, /languages: \$\{\{ matrix\.language \}\}\n          build-mode: none/u);
  assert.match(scanner, /source-root: \$\{\{ github\.workspace \}\}/u);
  assert.match(scanner, /checkout_path: \$\{\{ github\.workspace \}\}\n/u);
  assert.match(scanner, /ref: \$\{\{ github\.event_name == 'pull_request_target' && format\('refs\/pull\/\{0\}\/head', github\.event\.pull_request\.number\) \|\| github\.ref \}\}\n          sha: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(scanner, /node "\$TRUSTED_CONTROLS\/check-codeql-sarif\.mjs"/u);
  assert.doesNotMatch(scanner, /autobuild|npm |node candidate\/|bash candidate\/|working-directory: candidate|config-file:|continue-on-error/u);
  assert.equal((trusted.match(/security-events: write/gu) || []).length, 1);
  for (const job of trusted.split(/\n  (?=[a-z]+:\n)/u)) {
    if (!job.startsWith("codeql:\n")) assert.doesNotMatch(job, /security-events: write/u);
  }
});
test("native CodeQL admission permits only main push and same-repository target PRs", () => {
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  const scanner = trusted.slice(trusted.indexOf("\n  codeql:\n"), trusted.indexOf("\n  required:\n"));
  const expression = scanner.match(/    if: >-\n      \$\{\{ ([\s\S]*?) \}\}\n    runs-on:/u)?.[1].replace(/\s+/gu, " ");
  assert.equal(expression, "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request_target' && github.event.pull_request.head.repo.full_name == github.repository)");
  // This fixed, asserted expression uses only string equality and boolean
  // operators shared with JavaScript. It does not emulate all Actions syntax.
  const eligible = new Function("github", `return (${expression});`);
  for (const [eventName, ref, headRepository, expected] of [
    ["push", "refs/heads/main", "", true],
    ["push", "refs/heads/topic", "", false],
    ["pull_request_target", "refs/heads/main", "openboa-ai/.github", true],
    ["pull_request_target", "refs/heads/main", "outsider/.github", false],
    ["pull_request_target", "refs/heads/main", "", false],
    ["pull_request", "refs/pull/1/merge", "openboa-ai/.github", false],
    ["workflow_dispatch", "refs/heads/main", "openboa-ai/.github", false],
    ["workflow_run", "refs/heads/main", "openboa-ai/.github", false],
  ]) {
    const context = { event_name: eventName, ref, repository: "openboa-ai/.github", event: { pull_request: { head: { repo: { full_name: headRepository } } } } };
    assert.equal(eligible(context), expected, JSON.stringify(context));
  }
  assert.match(scanner, /needs: verify\n/u);
  assert.doesNotMatch(expression, /always\(|success\(/u);
});
test("CodeQL root checkout preserves only base validators outside the candidate source tree", () => {
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  const scanner = trusted.slice(trusted.indexOf("\n  codeql:\n"), trusted.indexOf("\n  required:\n"));
  const step = scanner.slice(scanner.indexOf("      - name: Preserve approved validators"), scanner.indexOf("      - name: Check out exact candidate source"));
  const script = step.split("        run: |\n")[1].trimEnd().split("\n").map((line) => line.slice(10)).join("\n");
  // Match the runner's canonical temp path, including on macOS /var -> /private/var.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "central-codeql-layout-")));
  const workspace = join(root, "workspace");
  const runnerTemp = join(root, "runner-temp");
  const helperNames = ["check-codeql-sarif.mjs", "reject-candidate-authorities.sh"];
  try {
    mkdirSync(workspace); mkdirSync(runnerTemp);
    const runnerTempAlias = join(root, "runner-temp-alias");
    symlinkSync(runnerTemp, runnerTempAlias);
    git(workspace, "init", "-q");
    for (const name of helperNames) write(workspace, ".github/scripts/" + name, readFileSync(join(source, ".github/scripts", name), "utf8"));
    write(workspace, "base-only.mjs", "throw Error('base-only source must not be extracted');\n");
    const base = commit(workspace);
    rmSync(join(workspace, "base-only.mjs"));
    for (const name of helperNames) write(workspace, ".github/scripts/" + name, "echo candidate helper must not execute >&2; exit 91\n");
    write(workspace, "candidate.mjs", "export const candidate = true;\n");
    write(workspace, ".github/workflows/candidate.yml", "name: Candidate\non: push\njobs: {}\n");
    const candidate = commit(workspace);
    git(workspace, "checkout", "-q", base);
    const output = join(runnerTemp, "output");
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
      cwd: workspace, env: { PATH: process.env.PATH, RUNNER_TEMP: runnerTempAlias, GITHUB_OUTPUT: output }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const controls = readFileSync(output, "utf8").trim().replace(/^directory=/u, "");
    assert.ok(controls.startsWith(runnerTemp + "/"));
    assert.ok(!controls.startsWith(workspace + "/"));
    assert.deepEqual(readdirSync(controls).sort(), helperNames);
    write(workspace, "untracked-base-only.mjs", "throw Error('untracked base source');\n");
    // Match checkout's clean/reset behavior before the exact candidate checkout.
    git(workspace, "clean", "-ffdx"); git(workspace, "reset", "--hard", "HEAD");
    git(workspace, "checkout", "--force", "-q", candidate);
    assert.equal(git(workspace, "status", "--porcelain"), "");
    assert.equal(git(workspace, "rev-parse", "HEAD").trim(), candidate);
    assert.deepEqual(git(workspace, "ls-files").trim().split("\n"), [
      ".github/scripts/check-codeql-sarif.mjs", ".github/scripts/reject-candidate-authorities.sh", ".github/workflows/candidate.yml", "candidate.mjs",
    ]);
    assert.deepEqual(readdirSync(workspace).sort(), [".git", ".github", "candidate.mjs"]);
    for (const name of helperNames) assert.equal(readFileSync(join(controls, name), "utf8"), readFileSync(join(source, ".github/scripts", name), "utf8"));
    assert.equal(spawnSync("bash", [join(controls, "reject-candidate-authorities.sh"), workspace]).status, 0);
    const sarif = join(runnerTemp, "sarif");
    json(sarif, "actions.sarif", { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }] });
    assert.equal(spawnSync(process.execPath, [join(controls, "check-codeql-sarif.mjs"), sarif]).status, 0);
    json(sarif, "actions.sarif", { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [{ message: { text: "finding" } }] }] });
    assert.notEqual(spawnSync(process.execPath, [join(controls, "check-codeql-sarif.mjs"), sarif]).status, 0);
    symlinkSync("candidate.mjs", join(workspace, "escape")); git(workspace, "add", "--all");
    assert.notEqual(spawnSync("bash", [join(controls, "reject-candidate-authorities.sh"), workspace]).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("central required check rejects failed, cancelled, skipped and missing lanes", () => {
  const trusted = readFileSync(join(source, ".github/workflows/ci.yml"), "utf8");
  const aggregate = trusted.slice(trusted.indexOf("\n  required:\n"));
  assert.match(aggregate, /name: Organization controls verification\n    if: \$\{\{ always\(\) \}\}\n    needs: \[verify, codeql\]/u);
  assert.match(aggregate, /permissions: \{\}/u);
  assert.equal((trusted.match(/name: Organization controls verification\n/gu) || []).length, 1);
  const script = aggregate.split("        run: |\n")[1].split("\n").map((line) => line.slice(10)).join("\n");
  for (const verify of ["success", "failure", "cancelled", "skipped", undefined]) {
    for (const codeql of ["success", "failure", "cancelled", "skipped", undefined]) {
      const env = { PATH: process.env.PATH };
      if (verify !== undefined) env.VERIFY_RESULT = verify;
      if (codeql !== undefined) env.CODEQL_RESULT = codeql;
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], { env });
      assert.equal(result.status === 0, verify === "success" && codeql === "success", `${verify}/${codeql}`);
    }
  }
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

function auditSnapshot(repository = "coffee-chat-bench") {
  const snapshot = {
    rulesets: [{ enforcement: "active", conditions: { ref_name: { include: ["refs/heads/main"] } }, bypass_actors: [], rules: [
      ...["deletion", "non_fast_forward", "required_linear_history"].map((type) => ({ type })),
      { type: "pull_request", parameters: { require_code_owner_review: true, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: repository === ".github" ? "Organization controls verification" : "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required", integration_id: 15368 }] } },
    ] }],
    environment: repository === ".github" ? null : { can_admins_bypass: false, protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "SonSangjoon" } }] }] },
    actions: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
  };
  snapshot.rulesets[0].id = 42;
  snapshot.branchRules = snapshot.rulesets[0].rules.map((rule) => ({ ...rule, ruleset_id: 42 }));
  return snapshot;
}
test("live settings audit distinguishes declarations from enforced reviews and checks", () => {
  const snapshot = auditSnapshot();
  assert.deepEqual(auditSettings("coffee-chat-bench", snapshot).issues, []);
  for (const exclude of [["refs/heads/main"], ["~DEFAULT_BRANCH"], ["refs/heads/m*"], ["~ALL"]]) {
    const excluded = structuredClone(snapshot);
    excluded.rulesets[0].conditions.ref_name.exclude = exclude;
    // GitHub's effective-branch endpoint returns no rules for these declarations.
    excluded.branchRules = [];
    assert.ok(auditSettings("coffee-chat-bench", excluded).issues.includes("No active ruleset protects main."));
  }
  const missing = structuredClone(snapshot);
  delete missing.branchRules;
  assert.ok(auditSettings("coffee-chat-bench", missing).issues.includes("Effective main rules could not be verified."));
  const incomplete = structuredClone(snapshot);
  incomplete.rulesets = [];
  assert.ok(auditSettings("coffee-chat-bench", incomplete).issues.includes("Applicable ruleset details could not be verified: 42"));
  const hiddenBypass = structuredClone(snapshot);
  delete hiddenBypass.rulesets[0].bypass_actors;
  assert.ok(auditSettings("coffee-chat-bench", hiddenBypass).issues.includes("Applicable ruleset details could not be verified: 42"));
  const layered = structuredClone(snapshot);
  layered.branchRules.unshift({ type: "pull_request", ruleset_id: 43, parameters: {} }, { type: "required_status_checks", ruleset_id: 43, parameters: {} });
  layered.rulesets.push({ id: 43, enforcement: "active", bypass_actors: [] });
  assert.deepEqual(auditSettings("coffee-chat-bench", layered).issues, []);
  const emptyStrict = structuredClone(layered);
  for (const rule of emptyStrict.branchRules.filter((rule) => rule.type === "required_status_checks")) {
    rule.parameters.strict_required_status_checks_policy = rule.ruleset_id === 43;
    if (rule.ruleset_id === 43) rule.parameters.required_status_checks = [];
  }
  assert.ok(auditSettings("coffee-chat-bench", emptyStrict).issues.includes("Required checks do not require an up-to-date branch."));
  snapshot.environment.protection_rules = [];
  assert.ok(auditSettings("coffee-chat-bench", snapshot).issues.includes("coffee-security has no required reviewers."));
  snapshot.rulesets = [];
  snapshot.branchRules = [];
  assert.ok(auditSettings("coffee-chat-bench", snapshot).issues.includes("No active ruleset protects main."));
});

test("environment audit requires the owner exclusively and verifies administrator bypass", () => {
  const owner = { type: "User", reviewer: { login: "SonSangjoon" } };
  const other = { type: "User", reviewer: { login: "openboa" } };
  const team = { type: "Team", reviewer: { login: "SonSangjoon", slug: "owners" } };
  for (const repository of ["coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench"]) {
    assert.deepEqual(auditSettings(repository, auditSnapshot(repository)).issues, []);
    for (const reviewers of [[other], [team], [owner, other], [owner, team], [other, owner], [], [{}], [{ type: "User", reviewer: {} }], "not-an-array", null]) {
      const snapshot = auditSnapshot(repository);
      snapshot.environment.protection_rules[0].reviewers = reviewers;
      assert.ok(auditSettings(repository, snapshot).issues.includes("coffee-security must require only User SonSangjoon."));
    }
    for (const bypass of [true, undefined, null, "false"]) {
      const snapshot = auditSnapshot(repository);
      snapshot.environment.can_admins_bypass = bypass;
      assert.ok(auditSettings(repository, snapshot).issues.some((issue) => /administrator bypass/u.test(issue)));
    }
    const duplicate = auditSnapshot(repository);
    duplicate.environment.protection_rules.push({ type: "required_reviewers", reviewers: [other] });
    assert.ok(auditSettings(repository, duplicate).issues.includes("coffee-security must require only User SonSangjoon."));
    const normal = auditSnapshot(repository);
    normal.environment.protection_rules[0].reviewers[0].reviewer.login = "sonsangjoon";
    normal.environment.protection_rules[0].prevent_self_review = true;
    normal.environment.protection_rules.push({ type: "branch_policy" });
    assert.deepEqual(auditSettings(repository, normal).issues, []);
  }
  assert.deepEqual(auditSettings(".github", auditSnapshot(".github")).issues, []);
});

test("settings audit rejects effective merge queues but ignores excluded declarations", () => {
  for (const repository of [".github", "coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench"]) {
    for (const id of [42, 43]) {
      const snapshot = auditSnapshot(repository);
      if (id === 43) snapshot.rulesets.push({ id, enforcement: "active", bypass_actors: [] });
      snapshot.branchRules.push({ type: "merge_queue", ruleset_id: id });
      assert.ok(auditSettings(repository, snapshot).issues.includes("Merge queue is enabled for main."));
    }
    const excluded = auditSnapshot(repository);
    excluded.rulesets.push({ id: 43, enforcement: "active", bypass_actors: [], conditions: { ref_name: { include: ["~ALL"], exclude: ["refs/heads/main"] } }, rules: [{ type: "merge_queue" }] });
    assert.deepEqual(auditSettings(repository, excluded).issues, []);
  }
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
