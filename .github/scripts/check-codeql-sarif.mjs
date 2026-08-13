#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAX_DIRECTORIES = 16;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStableRegularFile(path) {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = openSync(path, flags);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      fail(`CodeQL SARIF must be a regular file: ${path}`);
    }
    if (before.size > BigInt(MAX_FILE_BYTES)) {
      fail(`CodeQL SARIF exceeds the per-file byte budget: ${path}`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[field] !== after[field]) {
        fail(`CodeQL SARIF changed while being read: ${path}`);
      }
    }
    if (BigInt(bytes.byteLength) !== before.size) {
      fail(`CodeQL SARIF byte count changed while being read: ${path}`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function discoverSarif(root) {
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    fail("CodeQL SARIF output must be a regular directory");
  }
  const directories = [resolve(root)];
  const sarifFiles = [];
  for (let index = 0; index < directories.length; index += 1) {
    if (directories.length > MAX_DIRECTORIES) {
      fail("CodeQL SARIF output exceeds the directory budget");
    }
    const directory = directories[index];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const path = resolve(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        fail(`CodeQL SARIF output must contain only regular files: ${path}`);
      }
      if (stats.isDirectory()) {
        directories.push(path);
      } else if (stats.isFile() && entry.name.endsWith(".sarif")) {
        sarifFiles.push(path);
        if (sarifFiles.length > MAX_FILES) {
          fail("CodeQL SARIF output exceeds the file budget");
        }
      } else if (!stats.isFile()) {
        fail(`CodeQL SARIF output contains an unsupported entry: ${path}`);
      }
    }
  }
  if (sarifFiles.length === 0) {
    fail("CodeQL analysis did not produce a SARIF file");
  }
  return sarifFiles;
}

export function checkCodeqlSarif(root) {
  const sarifFiles = discoverSarif(root);
  let totalBytes = 0;
  let resultCount = 0;
  for (const path of sarifFiles) {
    const bytes = readStableRegularFile(path);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      fail("CodeQL SARIF output exceeds the aggregate byte budget");
    }
    let document;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail(`CodeQL SARIF is not valid JSON: ${path}`);
    }
    if (
      !isRecord(document) ||
      document.version !== "2.1.0" ||
      !Array.isArray(document.runs) ||
      document.runs.length === 0
    ) {
      fail(`CodeQL SARIF has an invalid top-level contract: ${path}`);
    }
    for (const run of document.runs) {
      if (
        !isRecord(run) ||
        !isRecord(run.tool) ||
        !isRecord(run.tool.driver) ||
        run.tool.driver.name !== "CodeQL"
      ) {
        fail(`CodeQL SARIF has an invalid tool identity: ${path}`);
      }
      const results = run.results ?? [];
      if (!Array.isArray(results) || results.some((result) => !isRecord(result))) {
        fail(`CodeQL SARIF has an invalid result contract: ${path}`);
      }
      resultCount += results.length;
    }
  }
  if (resultCount !== 0) {
    fail(`CodeQL findings must be reviewed before merge: ${resultCount}`);
  }
  return { files: sarifFiles.length, results: resultCount };
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === modulePath) {
  if (process.argv.length !== 3) {
    fail("usage: check-codeql-sarif.mjs <sarif-output-directory>");
  }
  process.stdout.write(`${JSON.stringify(checkCodeqlSarif(process.argv[2]))}\n`);
}
