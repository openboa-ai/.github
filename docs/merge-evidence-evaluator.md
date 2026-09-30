# Report-only merge evidence evaluator

`lib/evaluate-merge-evidence.mjs` exports the pure Node function
`evaluateMergeEvidence(trustedPolicy, snapshot)`. It calculates eligibility only.
It has no network, filesystem, shell, token, API-write, or merge implementation.
`npm test` includes bounded synthetic positive and negative controls using the
public OpenBOA workflow topology. Those tests are not evidence of a live eligible PR.

## Trust boundary

The two JSON inputs are **not self-authenticating**. A forged snapshot identical
to a genuine observation produces the same answer. Digests establish consistency,
not origin. `status: "verified"` is a collector's claim; this library does not
turn a receipt or artifact into an attestation.

The initial explicit trust model is `trusted-solo-writer`: an owner-approved
policy and collector come from an independently selected immutable trusted
revision. Untrusted PR files must never choose the policy, its allowlist, workflow
IDs, expected steps, source closure, or collector revision. A collector must use
authenticated platform reads, bind artifacts to the expected current run and
upload job, compare the source receipt to Git/API observations, and compare every
control file with the trusted manifest. Trusted inline source receipts execute
before candidate programs; their placement is established by reviewing the
unchanged workflow/control closure. A malicious repository writer able to change
trusted policy or platform settings is outside this model. No second account,
cryptographic artifact attestation, or stronger Free server enforcement is claimed.

This version targets the actual three separate OpenBOA PR workflows: CI, CodeQL,
and convention. Native Code Quality is a fourth, platform-managed gate. Never
combine jobs from different runs or invent a repository source hash for a dynamic
platform workflow. The first attempt only is eligible; reruns require an explicit
future contract extension because artifact APIs do not natively attest attempt
and producer-job identity. Missing, unavailable, ambiguous, or contradictory
collection evidence blocks eligibility.

An `eligible: true` answer is a **readiness snapshot**, not permission to merge,
proof of a Code Quality-specific rule verdict, or atomic server enforcement.
Observed `mergeable: true` and `mergeableState: "clean"` are aggregate platform
readiness, checked in addition to native run/job results and unchanged native
rule configuration. Unknown/dirty/blocked/behind/unstable states deny. A future
separately authorized merge caller must freshly re-read identities and readiness,
use the exact expected head, and obey the native rules without bypass. There is
no merger or standing auto-merge authorization in this change. Owner confirmation
and arbitrary `manualOverride` properties cannot make failed evidence pass.

## Initial scope

Only exact, owner-reviewed inert `.md` paths in `allowedDocumentationPaths` are
eligible. The collector supplies the complete changed-file set and base/head
modes; the evaluator independently checks every old and new rename path. It does
not trust candidate scope outputs. Symlinks, executable modes, unknown paths,
workflow/agent/hook/auth/deploy/release/install/lock/test-control changes and any
control-closure change deny. A `.md` extension alone does not establish that a
file is inert; the trusted allowlist review must establish that fact.

For this complete documentation-only classification, CI `check` and
`desktop-artifact` may be skipped with no steps; all other CI jobs (including
docs), all three CodeQL language jobs, convention, and native Code Quality must
succeed. An optional lane that runs must pass its mandatory steps. This cannot be
used to exempt a code or dependency change. Compatible dependency updates may be
added by a later explicit policy/validation change; they are not permanently
forbidden. Current infrastructure changes remain ineligible.

## Input contract v1

Both arguments are plain JSON values. SHA fields below are lowercase full 40-hex
commit IDs; SHA-256 digests are lowercase 64-hex. IDs are positive safe integers.
The implementation accepts at most 8 MiB of strings, 50,000 nodes and depth 24 per input;
individual raw SARIF strings are limited to 2 MiB. It rejects object accessors,
non-JSON values and excessive input. It does not execute candidate code.

The exhaustive executable example is `fixture()` in
`scripts/test-merge-evidence.mjs`. Its observations, commits, artifacts and digests
are synthetic. These are the static policy fields:

| Field | Required meaning |
| --- | --- |
| `version` | `1` |
| `trustModel`, `deploymentPlan` | `trusted-solo-writer`, `free`; deployment choice, not an API billing assertion |
| `repository` | `{id, fullName}` from trusted deployment configuration |
| `controlSha` | Immutable independently selected controller/policy revision |
| `maxAgeMs` | Positive observation freshness limit, at most 300000 |
| `runs` | Exactly three definitions with roles `ci`, `codeql`, `convention`; each `{role, workflowId, path, event:"pull_request", jobs}` |
| `jobs` within a run | Exact `{role, name, steps:[mandatory step names]}` entries; display names remain literal platform values |
| CI job roles | `scope`, `policy`, `secrets`, `gitleaks`, `dependencies`, `check`, `docs`, `desktop`, `aggregate` |
| CodeQL job roles | `actions`, `javascript-typescript`, `python` |
| Convention job role | `convention` |
| `requiredChecks` | Exact aggregate/convention `{context, appId}` pairs; unmodeled required checks deny |
| `platformGate` | `{workflowId, path:"dynamic/github-code-quality/codeql", event:"dynamic", appId, jobs:["Analyze (python)","Analyze (javascript-typescript)"]}` |
| `codeqlVersion` | Exact producer CLI semantic version; derive from the pinned action and confirm emitted SARIF |
| `receiptCategories` | Exact configured category per each of the three languages |
| `sarifCategories` | Exact emitted SARIF automation ID per language, which may differ from the configured category |
| `allowedDocumentationPaths` | Exact reviewed inert `.md` paths, at most 100 |
| `protectedPaths` | Additional protected paths or directory roots, no glob interpretation |
| `controlClosure` | Exact `{path, sha256}` manifest of all transitive execution/test/policy authorities; includes all three workflow paths, at most 100 |

The library does not discover the transitive closure. The trusted policy review
and collector must account for reusable workflows, local actions, parsers,
validation scripts, install hooks, dependency manifests/locks, agent instructions
and other inputs able to change a mandatory check. An incomplete trusted manifest
is not repaired by passing `complete: true`.

Snapshot fields:

| Field | Shape/semantics |
| --- | --- |
| `version` | `1` |
| `collection` | `{status:"completed", drift:false, errors:[], blockers:[]}` only after successful bounded collection |
| `collectedAt`, `evaluationTime` | Trusted caller epoch milliseconds; evaluation clock does not come from candidate data |
| `selection` | `{status:"verified", pullRequestNumber, baseSha, headSha, testedSha, runs:[{role,id,attempt:1,latestAttempt:1}], platformGate:{id,attempt:1,latestAttempt:1}}`; platform-authenticated current PR/test merge/run selection, not static policy |
| `repository` | `{id,fullName,visibility:"public",defaultBranchSha}`; private Free is ineligible |
| `pullRequest` | `{number,state:"open",draft:false,baseSha,headSha,headRepositoryId,baseAncestorOfHead:true,changedFiles,mergeable:true,mergeableState:"clean"}` |
| `controlSha` | Actual trusted controller revision, must match static policy |
| `rules` | `{complete:true,enforcement:"active",requirePullRequest:true,strictRequiredChecks:true,bypassActors:[],requiredChecks,codeQuality:"errors",codeScanning:{tool:"CodeQL",securityThreshold:"high_or_higher",alertsThreshold:"errors"}}` |
| `scope` | `allowlisted-documentation`; declaration is independently verified from files |
| `files` | `{complete:true,treeComplete:true,treesTruncated:false,totalCount,pages,entries}`; 1–100 files, count exactly matches PR changed-file count and entries |
| `pages` | Sequential `{number,count,bodySha256}`; counts sum to total; collector must prove no omitted pages from real pagination/trees, not manufacture metadata |
| file entry | `{path,status,previousPath?,oldMode,newMode}`; `previousPath` required only for renamed; status added/modified/removed/renamed; mode `100644`, absent side `null` |
| `controlClosure` | `{complete:true,entries:[{path,baseSha256,headSha256,testedSha256,baseMode,headMode,testedMode}]}`; exact trusted set/hashes, all modes `100644` |
| `runs` | Exactly CI/CodeQL/convention observations described below |
| `platformGate` | Separate native run observation described below |
| `sarif` | Exactly one raw report envelope per required CodeQL language |

Every repository run is
`{role,id,repositoryId,workflowId,path,event,attempt,latestAttempt,baseSha,headSha,controlSha,status,conclusion,jobsComplete,totalJobs,jobs,sourceProof}`.
Status/conclusion must be `completed`/`success`. Jobs are exactly the trusted set
with unique IDs and `{id,name,runId,attempt,headSha,status,conclusion,stepsComplete,steps}`.
Each mandatory step name appears once with literal completed/success. Missing,
duplicate or unexpected jobs deny. Apart from the two justified docs skips,
skipped/neutral/failure/cancelled/missing results deny.

`sourceProof` is `{status:"verified",kind:"trusted-inline-receipt-platform-correlation",receipts}`.
Each receipt envelope is `{status:"verified",artifactId,artifactName,jobId,receipt}`.
CI requires its scope job receipt; convention its convention receipt; CodeQL
requires all three language-job receipts. Source artifact names are exactly
`merge-source-RUNID-ATTEMPT`; CodeQL names are
`merge-evidence-RUNID-ATTEMPT-LANGUAGE`. The collector must verify archive digest,
member safety, platform artifact/run identity, expected upload job/step and its
time interval before claiming verified. This is correlation under the stated
writer trust model, not native job/attempt cryptographic binding.

The flat receipt contains
`{schemaVersion:1,repositoryId,repository,runId,runAttempt,workflowRef,workflowPath,workflowSha,workflowSha256,event,eventSha,headSha,baseSha,checkoutSha,parents,jobName,language?,category?}`.
For this normal PR contract, `workflowRef` is exactly
`OWNER/REPO/.github/workflows/FILE.yml@refs/pull/N/merge`;
workflow/event/checkout SHAs equal the selected tested merge, whose ordered parents
are `[baseSha,headSha]`. `workflowSha256` equals the trusted workflow digest. Source artifact IDs must be globally unique across all
five producer jobs.
Language/category are mandatory for CodeQL. A reusable call with a different
checkout revision is not silently normalized to this PR contract.

Native `platformGate` is
`{id,repositoryId,workflowId,path,event,appId,headSha,attempt:1,latestAttempt:1,status:"completed",conclusion:"success",complete:true,totalJobs,jobs}`.
Its ID/attempt/latest-attempt must also match the separately selected native
platform tuple. It has the exact two native jobs, with unique IDs and bound run/attempt/head,
completed/success outcomes and complete steps. Both `Initialize CodeQL` and
`Perform CodeQL Analysis` must succeed. Its App identity must come from collected
platform checks; do not copy an expected policy value into an observed field.
This library requires no invented native workflow source receipt or native
rule-specific verdict.

Each SARIF envelope is
`{language,jobName,runId,attempt,headSha,errors:[],rawSarif,sha256,provenance}`.
`provenance` is `{status:"verified",artifactId,artifactName,jobId,runId,attempt,workflowSha}`
and must match the corresponding already-verified source artifact. `rawSarif` is
the exact original UTF-8 text, not reserialized JSON. Its digest must match.
The report must be SARIF 2.1.0 with exactly one CodeQL run, expected CLI version
and exact automation ID, explicit empty results, successful invocations and no
error notifications. Reports must be self-contained: nonempty or unrecognized
external-property references and inline external property data deny; no external
reference is fetched. Conversion sections are unsupported for this direct CodeQL
contract and deny rather than allowing nested conversion errors. Even suppressed results deny. Empty raw results describe
only that scoped analysis and are not a claim of a full source-security audit. Missing raw reports/languages,
extractor errors or native-alert API zero cannot substitute for raw evidence.

## Output and validation

A positive result is
`{eligible:true,classification:"allowlisted-documentation",repository,headSha,testedSha,runs:[{role,id,attempt}]}`.
A denial is `{eligible:false,reason}`. The reason is a diagnostic, not a waiver.
The caller should report collection gaps separately and preserve all evidence.

Run `npm test`. The tests exercise three separate real workflow identities using
synthetic observations, approved docs skips, exact source/artifact binding,
renames, incomplete pagination, stale tuples, missing/duplicate/unexpected jobs,
raw SARIF failures, unknown platform readiness and owner-override attempts.
No test claims to perform hosted CodeQL extraction, a live collection or a merge.
