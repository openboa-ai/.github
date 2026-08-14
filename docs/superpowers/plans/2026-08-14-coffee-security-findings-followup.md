# Coffee Security Findings Follow-up Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with specification and quality reviews.

**Goal:** Close every validated post-scan finding across the four Coffee repositories while preserving automatic routine Dependabot merging and selective confirmation for executable trust-boundary changes.

**Architecture:** The organization-owned reusable workflow remains the trusted authorization boundary. Root package authority becomes sensitive in each target policy, with a narrow identity-bound Dependabot exception in the central classifier. The central quality runner independently removes npm binary links and invokes exact tool entrypoints. Eval and Bench receive their repository-specific integrity-path fixes.

**Tech Stack:** GitHub Actions reusable workflows, GitHub Environments and rulesets, Node.js 24 ESM, Bash, npm 11 lockfiles, `node:test`, CodeQL, dependency review, Gitleaks, Codex Security.

---

### Task 1: Lock the central classifier and execution contract with failing tests

**Files:**
- Modify: `scripts/test-coffee-required-workflow.mjs`
- Test: `scripts/test-coffee-required-workflow.mjs`

**Step 1: Add identity-aware classification fixtures**

Extend the fixture helpers to pass actor, PR author, base repository, and head
repository. Add cases proving exact in-repository Dependabot package-only
changes stay routine, while OWNER/MEMBER package changes, a Dependabot branch
from another repository, policy failure, and any additional protected file are
sensitive.

**Step 2: Add quality-runner contract tests**

Require both npm installs to use `--ignore-scripts --no-bin-links`. Reject
`npm run` and `npm test` delegation. Require direct Prettier, TypeScript, Node,
Python, shell, and Git command shapes for every target repository.

**Step 3: Run the focused suite and confirm RED**

Run: `npm test`

Expected: new classification and runner assertions fail against the old
implementation for the intended reasons.

### Task 2: Implement and publish the central controls

**Files:**
- Modify: `.github/scripts/classify-candidate.mjs`
- Modify: `.github/scripts/run-candidate-quality.sh`
- Modify: `.github/workflows/coffee-trusted-gate.yml`
- Modify: `scripts/test-coffee-required-workflow.mjs`

**Step 1: Implement the exact Dependabot exception**

Pass the trusted workflow identity fields into the classifier. Exempt only
`package.json` and `package-lock.json` when actor and author are both
`dependabot[bot]`, head equals base repository, and exact policy succeeded.
Return the full protected-change evidence even when those paths are exempted.

**Step 2: Remove candidate package-script command selection**

Install root and parser graphs with `--ignore-scripts --no-bin-links` under the
fixed npm configuration. Replace every candidate `npm run` or `npm test` call
with the exact direct command corresponding to the locked package script.

**Step 3: Run the central verification matrix**

Run:
- `npm test`
- `actionlint .github/workflows/*.yml`
- `sh -n .github/scripts/*.sh`
- `node --check .github/scripts/*.mjs`
- `git diff --check`

Expected: all pass.

**Step 4: Commit, review, publish, and merge**

Commit the central implementation separately from the design/plan commits.
Request an independent code review, push the branch, open a pull request, wait
for the trusted required context, apply the already-authorized Environment
confirmation if necessary, enable squash auto-merge, and verify the merged
`origin/main` SHA. This SHA is the immutable pin for Tasks 3–6.

### Task 3: Harden Coffee package authority

**Files:**
- Modify: `.github/merge-policy.json`
- Modify: `.github/ci-policy.mjs`
- Modify: `.github/workflows/trusted.yml`
- Modify: `CODEOWNERS`
- Modify: `AGENTS.md`
- Modify: `tests/workflow-policy.test.mjs`

**Step 1: Add failing policy fixtures**

Require `/package.json` and `/package-lock.json` in the exact protected-path
manifest and reject removing either. Require the trusted wrapper's control SHA
to equal the merged Task 2 SHA.

**Step 2: Implement the policy and documentation changes**

Add both package paths, align ownership/guidance, and update the immutable
central workflow pin without changing zero global approvals or Dependabot
version/security grouping.

**Step 3: Verify**

Run:
- `npm ci --ignore-scripts`
- `npm audit --audit-level=moderate`
- `npm run verify`
- `actionlint .github/workflows/*.yml`
- `git diff --check`

Expected: all pass and the worktree is clean after commit.

### Task 4: Harden Roastery package authority

**Files:**
- Modify: `.github/merge-policy.json`
- Modify: `.github/ci-policy.mjs`
- Modify: `.github/workflows/trusted.yml`
- Modify: `CODEOWNERS`
- Modify: `AGENTS.md`
- Modify: `tests/workflow-policy.test.mjs`

**Step 1: Add RED fixtures for missing package paths and stale control SHA**

Run: `npm run ci:policy`

Expected: the new fixtures fail against the old manifest.

**Step 2: Add package authority to the selective-review manifest**

Preserve the exact publication, source, generated `dist`, contract, and
Roastery data boundaries while adding the root package files and new central
pin.

**Step 3: Verify**

Run:
- `npm ci --ignore-scripts`
- `npm audit --audit-level=moderate`
- `npm run format:check`
- `npm run typecheck`
- `npm run dist:check`
- `npm run repository:check`
- `npm run smoke`
- `npm run package:check`
- `npm run ci:policy`
- `actionlint .github/workflows/*.yml`
- `git diff --check`

### Task 5: Harden Eval package and calibration evidence

**Files:**
- Modify: `.github/merge-policy.json`
- Modify: `.github/ci-policy.mjs`
- Modify: `.github/workflows/trusted.yml`
- Modify: `AGENTS.md`
- Modify: `src/pcda-receipt.ts`
- Modify: `evals/protocol-canary/environment/Dockerfile`
- Modify: `tests/pcda-receipt.test.ts`
- Modify: `tests/workflow-policy.test.mjs`

**Step 1: Add RED tests**

Add policy cases for the root package paths and
`tests/fixtures/pcda-calibration/**`. Add receipt cases that swap, duplicate, or
rename Oracle/no-op identities and expect rejection. Add a Dockerfile assertion
that forbids the unused online Codex install.

**Step 2: Bind and protect calibration evidence**

Require exact distinct `oracle` and `nop` agent roles before acceptance, protect
the fixture path, remove the unused installation, and pin the wrapper to the
merged central SHA.

**Step 3: Verify**

Run:
- `npm ci --ignore-scripts`
- `npm audit --audit-level=moderate`
- `npm run format:check`
- `npm run typecheck`
- `npm run build`
- `npm run canary:check`
- `npm test`
- `npm run dry-run`
- `npm run smoke`
- `npm run pcda:calibrate`
- `npm run ci:policy`
- `actionlint .github/workflows/*.yml`
- `git diff --check`

### Task 6: Harden Bench executable quality inputs

**Files:**
- Modify: `.github/merge-policy.json`
- Modify: `.github/ci-policy.mjs`
- Modify: `.github/workflows/trusted.yml`
- Modify: `CODEOWNERS`
- Modify: `AGENTS.md`
- Modify: `tests/workflow-policy.test.mjs`

**Step 1: Add RED protected-path fixtures**

Require root package authority, `/prettier.config.mjs`, and `/tests/**` in the
exact protected manifest. Add a fixture for each omitted executable path and
for the stale central pin.

**Step 2: Implement the exact manifest and ownership contract**

Keep all existing judge, Harbor, schema, inactive-boundary, and `src/**`
protections. Align CODEOWNERS and solo-maintainer guidance and update the
trusted wrapper SHA.

**Step 3: Verify**

Run:
- `npm ci --ignore-scripts`
- `npm audit --audit-level=moderate`
- `npm run format:check`
- `npm run check:inactive`
- `npm run typecheck`
- `npm test`
- `npm run ci:policy`
- `actionlint .github/workflows/*.yml`
- `python3 -m py_compile harbor/verifier.py`
- `sh -n harbor/test.sh`
- `git diff --check`

### Task 7: Review, publish, merge, and verify the four targets

**Files:**
- Review: complete `origin/main...HEAD` in each target worktree

**Step 1: Request independent specification and code-quality reviews**

Resolve every P0–P2 issue with a fresh test-driven fix and re-review. Do not
publish a target until both reviews approve its exact clean HEAD.

**Step 2: Publish four pull requests and enable native auto-merge**

Confirm exact diff scope, commit intentionally, push, create the pull request,
observe the organization-owned required context, apply the already-authorized
Environment confirmation to these security changes, and enable squash
auto-merge. Record each merged SHA.

**Step 3: Re-read live GitHub state**

For every repository verify the active ruleset, exact required workflow/app
identity, zero global approvals, `coffee-security` reviewers, merge queue off,
Dependabot config, auto-merge, CodeQL/secret/dependency alerts, open PRs, and
default-branch workflow pin.

### Task 8: Final security and lifecycle acceptance

**Files:**
- Scan: four merged repository roots at their exact clean `origin/main` SHAs

**Step 1: Run fresh authoritative Standard Codex Security scans**

Use the Desktop scan workflow with preflight, independent baseline, focused
validation, complete coverage accounting, attack-path calibration, and sealed
reports for all four repositories.

**Step 2: Exercise routine and sensitive classification canaries**

Prove a routine non-sensitive candidate skips the Environment and remains
eligible for native auto-merge. Prove an OWNER/MEMBER package-file change is
sensitive, while an exact in-repository Dependabot package-only update remains
routine. Close the canaries without leaving open pull requests.

**Step 3: Final handoff**

Report merged SHAs, changed paths, exact verification results, live GitHub
state, scan IDs/report paths/findings, and any platform limitation. Do not call
the lifecycle complete unless every repository is clean and the live required
context has been observed after merge.
