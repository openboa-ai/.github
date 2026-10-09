// Explicit integration check; the offline unit-test image has no actionlint.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const binary = process.env.ACTIONLINT_BINARY || "actionlint";
assert.match(execFileSync(binary, ["-version"], { encoding: "utf8" }), /^1\.7\.12\n/u);
const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/repository-baseline.yml"), "utf8");
const step = workflow.split("      - name: Validate all candidate workflows with trusted configuration\n")[1].split("      - name:")[0];
const script = step.match(/        run: \|\n([\s\S]*)/u)[1].trimEnd().split("\n").map((line) => line.slice(10)).join("\n");
const write = (root, file, content) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), content); };
const valid = "name: Fixture\non: push\npermissions: {}\njobs:\n  check:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo checked\n";

for (const variant of ["normal", "leaf-link", "github-link", "workflows-link", "dangling", "directory", "fifo", "metadata-link", "invalid-runner"]) {
  const root = mkdtempSync(join(tmpdir(), "baseline-real-actionlint-"));
  try {
    write(root, "controls/.github/workflows/ci.yml", valid);
    const candidate = join(root, "candidate");
    if (variant === "github-link") {
      mkdirSync(candidate); symlinkSync("../controls/.github", join(candidate, ".github"));
    } else if (variant === "workflows-link") {
      mkdirSync(join(candidate, ".github"), { recursive: true });
      symlinkSync("../../controls/.github/workflows", join(candidate, ".github/workflows"));
    } else {
      const path = "candidate/.github/workflows/ci.yml";
      mkdirSync(dirname(join(root, path)), { recursive: true });
      if (variant === "leaf-link") symlinkSync("../../../controls/.github/workflows/ci.yml", join(root, path));
      else if (variant === "dangling") symlinkSync("missing", join(root, path));
      else if (variant === "directory") mkdirSync(join(root, path));
      else if (variant === "fifo") execFileSync("mkfifo", [join(root, path)]);
      else write(root, path, variant === "invalid-runner" ? valid.replace("ubuntu-24.04", "invalid-runner") : valid);
    }
    write(root, "trusted-empty.yml", "{}\n");
    const flags = ["-config-file", join(root, "trusted-empty.yml"), "-shellcheck=", "-pyflakes="];
    if (["leaf-link", "github-link", "workflows-link"].includes(variant)) {
      const original = spawnSync(binary, [...flags, "candidate/.github/workflows/ci.yml"], { cwd: root, encoding: "utf8" });
      assert.equal(original.status, 0, "Fixture must reproduce the original acceptance: " + original.stderr);
    }
    if (variant === "normal") {
      write(root, "candidate/.github/workflows/.hidden.yaml", valid);
      write(root, "candidate/.github/workflows/space name.yaml", valid);
    }
    if (["normal", "invalid-runner"].includes(variant)) {
      write(root, "candidate/.github/actionlint.yaml", "paths:\n  '**':\n    ignore: ['.*']\n");
    }
    if (variant === "metadata-link") {
      execFileSync("git", ["-C", candidate, "init", "--quiet"]);
      write(root, "outside/action.yml", "name: Outside fixture\ndescription: Inert fixture\ninputs:\n  outside-metadata-marker:\n    required: true\nruns:\n  using: node24\n  main: inert.js\n");
      symlinkSync("../outside", join(candidate, "local-action"));
      const content = valid.replace("run: echo checked", "uses: ./local-action");
      write(root, "candidate/.github/workflows/ci.yml", content);
      for (const [args, input] of [
        [["candidate/.github/workflows/ci.yml"], undefined],
        [["-stdin-filename", "candidate/.github/workflows/ci.yml", "-"], content],
      ]) {
        const original = spawnSync(binary, [...flags, ...args], { cwd: root, input, encoding: "utf8" });
        assert.equal(original.status, 1);
        assert.match(original.stdout + original.stderr, /outside-metadata-marker/u, "Fixture must prove the outside metadata was read");
      }
    }
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c",
      'actionlint() { command "$ACTIONLINT_BINARY" "$@"; }\n' + script], {
      cwd: root, env: { ...process.env, ACTIONLINT_BINARY: binary, RUNNER_TEMP: root }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined, variant + " must not hang");
    const output = result.stdout + result.stderr;
    if (["normal", "metadata-link"].includes(variant)) assert.equal(result.status, 0, output);
    else assert.notEqual(result.status, 0, variant + " must fail");
    assert.doesNotMatch(output, /outside-metadata-marker/u, "The trusted lint step must not read outside metadata");
    if (variant === "invalid-runner") assert.match(output, /label "invalid-runner" is unknown/u);
    console.log(`PASS: actual actionlint ${variant}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
