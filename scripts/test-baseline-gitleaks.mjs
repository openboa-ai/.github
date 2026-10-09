// Explicit integration test: requires Gitleaks 8.30.1 and its trusted config.
// Keep separate from offline npm tests, whose isolated image has no Gitleaks.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const binary = process.env.GITLEAKS_BINARY || "gitleaks";
const config = process.env.GITLEAKS_TRUSTED_CONFIG;
assert.ok(config, "GITLEAKS_TRUSTED_CONFIG must name the checksum-verified scanner config");
assert.equal(createHash("sha256").update(readFileSync(config)).digest("hex"), "e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf");
assert.equal(execFileSync(binary, ["version"], { encoding: "utf8" }).trim(), "8.30.1");
const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/repository-baseline.yml"), "utf8");
function script(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split("      - name:")[0];
  assert.ok(step);
  return step.match(/        run: \|\n([\s\S]*)/u)[1].trimEnd().split("\n").map((line) => line.slice(10)).join("\n");
}
const git = (root, ...args) => execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
const write = (root, file, content) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), content); };

for (const attributes of ["* -diff -whitespace", "* binary -whitespace"]) {
  const root = mkdtempSync(join(tmpdir(), "baseline-deleted-secret-"));
  const candidate = join(root, "candidate");
  try {
    mkdirSync(candidate);
    git(candidate, "init", "--initial-branch=main");
    git(candidate, "config", "user.name", "Fixture");
    git(candidate, "config", "user.email", "fixture@example.invalid");
    write(candidate, ".gitattributes", attributes + "\n");
    write(candidate, "nested/.gitattributes", attributes + "\n");
    write(candidate, "README.md", "Synthetic offline scanner fixture\n");
    git(candidate, "add", "."); git(candidate, "commit", "-m", "initial");
    const base = git(candidate, "rev-parse", "HEAD").trim();
    // Generated locally, never issued by a provider or sent to a service.
    const syntheticCredential = "ghp_" + randomBytes(18).toString("hex");
    write(candidate, "nested/removed.env", "EXAMPLE_CREDENTIAL=" + syntheticCredential + "\n");
    git(candidate, "add", "."); git(candidate, "commit", "-m", "synthetic historical fixture");
    rmSync(join(candidate, "nested/removed.env"));
    git(candidate, "add", "."); git(candidate, "commit", "-m", "remove fixture from working tree");
    const head = git(candidate, "rev-parse", "HEAD").trim();
    const env = { ...process.env, GITLEAKS_BINARY: binary, GITLEAKS_TRUSTED_CONFIG: config, HEAD_SHA: head, BASE_SHA: base, EVENT_NAME: "pull_request", REPOSITORY: "openboa-ai/example" };
    const prepare = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script("Verify candidate identity and whitespace")], { cwd: root, env, encoding: "utf8" });
    assert.equal(prepare.status, 0, prepare.stdout + prepare.stderr);
    const directory = spawnSync(binary, ["dir", "--config", config, "--gitleaks-ignore-path", "/dev/null", "--ignore-gitleaks-allow", "--redact", "--no-banner", candidate], { env, encoding: "utf8" });
    assert.equal(directory.status, 0, directory.stdout + directory.stderr);
    const scan = spawnSync("bash", ["-e", "-o", "pipefail", "-c",
      'gitleaks() { command "$GITLEAKS_BINARY" "$@"; }\n' + script("Scan candidate history and files with trusted configuration")], { cwd: root, env, encoding: "utf8" });
    const output = scan.stdout + scan.stderr;
    assert.equal(scan.status, 1, "Historical scanner must reject deleted credential: " + output);
    assert.match(output, /leaks found: 1/u);
    assert.doesNotMatch(output, new RegExp(syntheticCredential, "u"), "Scanner leaked fixture value rather than redacting it");
    console.log(`PASS: actual Gitleaks rejects deleted history credential despite ${attributes}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
