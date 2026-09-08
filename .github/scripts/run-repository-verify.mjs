import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePackage } from "./check-candidate-policy.mjs";

// Official Node image, resolved from node:24-bookworm. Update through control review.
export const IMAGE = "node@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2";

export function containerArgs(volume, network, command, { user = "1000:1000", stdin = false } = {}) {
  return ["run", "--rm", ...(stdin ? ["--interactive"] : []),
    "--name", `${volume}-job`, "--network", network, "--user", user,
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
    "--pids-limit=256", "--memory=2g", "--cpus=2",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=512m,mode=1777",
    "--mount", `type=volume,source=${volume},target=/work`,
    "--workdir", "/work", "--env", "CI=true", "--env", "HOME=/tmp",
    "--env", "NPM_CONFIG_USERCONFIG=/tmp/npm-userconfig", "--env", "NPM_CONFIG_GLOBALCONFIG=/tmp/npm-globalconfig",
    "--env", "NPM_CONFIG_CACHE=/tmp/npm-cache", "--env", "NPM_CONFIG_REGISTRY=https://registry.npmjs.org",
    "--env", "NPM_CONFIG_UPDATE_NOTIFIER=false", "--entrypoint", "/bin/sh",
    IMAGE, "-ec", command];
}

export function runRepositoryVerify(root) {
  validatePackage(root);
  const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, options = {}) => execFileSync("git", ["-C", root, ...args], { env: gitEnv, ...options });
  git(["diff", "--exit-code"]); // Include only the staged, reviewed tree, never local scratch files.
  const tree = git(["write-tree"], { encoding: "utf8" }).trim();
  const entries = git(["ls-tree", "-r", "--name-only", tree], { encoding: "utf8" });
  if (/^(?:.*\/)?(?:\.npmrc|npm-shrinkwrap\.json)$/mu.test(entries)) throw Error("alternate installation authority");
  const modes = git(["ls-tree", "-r", tree], { encoding: "utf8" });
  for (const entry of modes.trim().split("\n")) {
    if (!/^100(?:644|755) blob [0-9a-f]{40}\t/u.test(entry)) throw Error("snapshot contains a non-regular entry");
  }
  for (const file of entries.split("\n").filter((path) => /(^|\/)\.gitattributes$/u.test(path))) {
    if (/export-ignore|export-subst/u.test(readFileSync(resolve(root, file), "utf8"))) throw Error("archive transformations are not allowed");
  }
  const archive = git(["archive", "--format=tar", tree], { maxBuffer: 128 * 1024 * 1024 });
  const volume = `coffee-verify-${randomUUID()}`;
  const resume = randomUUID();
  const docker = (args, input) => {
    const result = spawnSync("docker", args, {
      stdio: input ? ["pipe", "inherit", "inherit"] : "inherit", input,
      timeout: 20 * 60 * 1000,
    });
    if (result.error || result.status !== 0) throw Error(`isolated verification failed (${result.status ?? result.error?.code})`);
  };
  try {
    docker(["volume", "create", volume]);
    docker(containerArgs(volume, "none", "chmod 0777 /work; touch /work/.initialized", { user: "0:0" }));
    docker(containerArgs(volume, "none", "mkdir repo; tar -xf - -C repo; cd repo; git -c core.hooksPath=/dev/null init -q; git -c core.hooksPath=/dev/null add -f --all", { stdin: true }), archive);
    // The installer sees public package data, never credentials. No package lifecycle runs.
    // Logs cannot issue workflow commands; the resume nonce never enters the container.
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::stop-commands::${resume}`);
    docker(containerArgs(volume, "bridge", "cd repo; npm ci --ignore-scripts --no-bin-links --no-fund; npm audit --audit-level=moderate"));
    // Candidate programs run only here: no network, host mount, socket, token or runner command file.
    docker(containerArgs(volume, "none", "cd repo; npm --ignore-scripts run verify"));
    return { tree, status: "verified", image: IMAGE };
  } finally {
    spawnSync("docker", ["rm", "--force", `${volume}-job`], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", volume], { stdio: "ignore" });
    if (process.env.GITHUB_ACTIONS === "true") console.log(`::${resume}::`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runRepositoryVerify(resolve(process.argv[2] ?? ".")))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
