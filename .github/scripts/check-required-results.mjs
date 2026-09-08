import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function checkRequiredResults(needs) {
  for (const job of ["authorize", "dependency-review", "codeql", "quality"]) {
    assert.equal(needs[job]?.result, "success", `${job}: required success is missing`);
  }
  const sensitive = needs.authorize.outputs?.sensitive;
  assert.ok(sensitive === "true" || sensitive === "false", "classification must be explicit");
  assert.equal(needs["sensitive-review"]?.result, sensitive === "true" ? "success" : "skipped",
    "sensitive approval must match the exact run classification");
  return { status: "required-checks-passed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(checkRequiredResults(JSON.parse(process.env.NEEDS_JSON)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
