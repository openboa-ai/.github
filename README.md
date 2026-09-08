# OpenBoa GitHub controls

Central controls answer whether a change meets security and approval policy.
Each Coffee Chat repository answers whether its own product or data is correct.
Neither requires the center to know Product Skills, benchmark folders, or an
evaluator implementation.

## Ownership and execution

1. An exact, inert wrapper selects this reusable workflow by immutable SHA.
2. Approved central code checks candidate data, existing protected paths, secrets,
   dependency changes and CodeQL findings. Invalid policy fails immediately.
3. Sensitive changes wait for the existing coffee-security approval.
4. The repository's npm run verify runs in an isolated container. Installation
   uses its integrity-locked registry dependencies without lifecycle scripts;
   candidate programs have no network, token, host mount or runner command files.
5. The unchanged required aggregate accepts only explicit successful results.
   GitHub applies required checks and independent review. Target wrappers retain
   only pull_request_target; they cannot add push or other execution triggers.
   Post-merge observation belongs to organization-owned orchestration; the
   target wrapper itself does not claim an automatic main-push check.

Targets are coffee-chat (Product), coffee-chat-roastery (public data seed),
coffee-chat-bench (evaluation definitions), and coffee-chat-eval (execution/evidence).
The project owner is SonSangjoon. Existing team ownership remains in CODEOWNERS;
the PR author cannot supply their own independent review.

## Verify the controls

Run npm run verify, actionlint (all workflow extensions), shell/Node syntax checks
and git diff --check. scripts/test-isolation.mjs additionally exercises the real
Docker boundary; it is explicit because unit-test containers cannot access the
host Docker socket. The pinned installer for actionlint verifies its SHA256.
The test suite covers malformed control data, protected-path removal, workflow
spoofing, installation authority, approval and cancelled/missing job results.

Trusted CI for this repository uses base-owned controls to execute candidate
regressions in isolation. Do not add a candidate-owned pull_request workflow as
a bootstrap: its author can change the host-runner steps before any guard or
container runs. The workflow inventory test detects drift during verification;
it is not a GitHub pre-execution enforcement barrier for new workflow files.

The first introduction cannot retroactively create base-owned CI on the old
base. Before requesting owner approval, complete latest-head Codex review,
resolve code findings, and retain exact-tree local regression, lint, secret-scan
and real-isolation evidence. Report missing GitHub CI as unverified, not passing;
do not create a substitute success check or bypass existing required checks.
The owner must review the initial landing, including this evidence gap. After
landing, observe trusted main CI before upgrading callers. Subsequent central
PRs require the base-owned CI as well as Codex review. Source commits in support
are full SHAs, not branch names. An old caller still uses its old pin on a rerun.

## Migration and evidence

Do not weaken a required check to change its implementation. Keep the canonical
PR-only wrapper shape unchanged, validate each target's actual base/head, then
update only its immutable control SHA. Existing protected paths, secret hooks, update policy and
required-check identity are retained. Changes to those safeguards require an
explicitly reviewed successor contract, not approval of an unrelated failure.

Use .github/scripts/audit-ci-settings.mjs to inspect live settings. It is read-only
and uses GitHub's effective main rules, including exclusions and inherited rules,
instead of treating declarations as enforcement. Missing ruleset/bypass details
remain unverified. CODEOWNERS keeps one location and its existing ordered routes
as a suffix; new routes go before them so they cannot override existing owners.
Owner additions use GitHub user/team handles; malformed tokens fail because they
can invalidate an entire route. Comments preserve those routes. Any initial
blocked-pin exception must be scoped to
an exact PR/base/head/control SHA, expire, include compensating verification and
leave all protections restored. Existing code-quality/coverage rules are not
deleted by this rollout; their producers must be verified before claiming success.

Local tests, live GitHub checks, owner approval, merged main and post-merge runs
are separate evidence states. No passing CI check is a Ground Truth approval,
Judge qualification, evaluator calibration or Product-performance result.
