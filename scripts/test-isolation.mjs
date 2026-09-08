import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const launcher = resolve(import.meta.dirname, "../.github/scripts/run-repository-verify.mjs");
for (const shouldPass of [true, false]) {
  const root = mkdtempSync(join(tmpdir(), "coffee-ci-isolation-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "isolation-probe", version: "0.0.0", private: true, scripts: { verify: "node verify.mjs" } }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "isolation-probe", version: "0.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "isolation-probe", version: "0.0.0" } } }));
    const hostOnly = join(root, "host-only-canary");
    const probe = [
      'import assert from "node:assert/strict";',
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      'import { networkInterfaces } from "node:os";',
      'assert.notEqual(process.getuid(), 0);',
      'for (const key of ["COFFEE_CI_CANARY", "GITHUB_TOKEN", "GITHUB_OUTPUT", "GITHUB_ENV", "ACTIONS_RUNTIME_TOKEN", "DOCKER_HOST"]) assert.equal(process.env[key], undefined, key);',
      'assert.equal(existsSync("/var/run/docker.sock"), false);',
      'assert.equal(existsSync(' + JSON.stringify(hostOnly) + '), false);',
      'assert.deepEqual(Object.keys(networkInterfaces()), ["lo"]);',
      'const status = readFileSync("/proc/self/status", "utf8");',
      'assert.match(status, /CapEff:\\s+0+\\n/);',
      'assert.match(status, /NoNewPrivs:\\s+1\\n/);',
      'assert.throws(() => writeFileSync("/root-write-probe", "denied"));',
      'await assert.rejects(fetch("http://192.0.2.1", { signal: AbortSignal.timeout(1000) }));',
      'console.log("isolation assertions passed");',
      'console.log("::notice::candidate log must not become a workflow command");',
      shouldPass ? 'process.exit(0);' : 'process.exit(23);',
    ].join("\n");
    writeFileSync(join(root, "verify.mjs"), probe);
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "add", "--all"]);
    writeFileSync(hostOnly, "non-secret local canary");
    const result = spawnSync(process.execPath, [launcher, root], {
      env: { ...process.env, COFFEE_CI_CANARY: "non-secret-inheritance-probe", GITHUB_ACTIONS: "true" },
      encoding: "utf8", timeout: 120000,
    });
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.match(output, /isolation assertions passed/, output);
    assert.equal(result.status === 0, shouldPass, output);
    const volume = output.match(/^coffee-verify-[0-9a-f-]+$/m)?.[0];
    assert.ok(volume, output);
    assert.notEqual(spawnSync("docker", ["volume", "inspect", volume]).status, 0, "temporary volume leaked");
    assert.notEqual(spawnSync("docker", ["inspect", volume + "-job"]).status, 0, "temporary container leaked");
    assert.match(output, /::stop-commands::[0-9a-f-]+/);
    console.log(shouldPass ? "PASS: real non-root, network, credential, host and log isolation" : "PASS: failed verification propagates and isolated state is removed");
  } finally { rmSync(root, { recursive: true, force: true }); }
}
