# Review remediation: candidate data and caller provenance

Proposed implementation contract for PR #24 at
`04b282e50ed07ebf4ddb467dac95c2f7222f199e`. This addendum supersedes the
original specification's event and candidate retrieval clauses only after
independent source review. Protected policy adoption still requires the native
current-head code-owner approval; source acceptance cannot grant that approval.

## Intent and boundaries

Keep the reusable hygiene check additive and data-only. Reject workflow paths
that redirect linting outside candidate workflow files, obtain supported PR heads
using the base repository's existing read token, and take the trusted caller from the
base branch rather than candidate-authored workflow content. No product code,
new credentials, inherited secrets, write permission, deployment, required-gate
removal or controller admission relaxation is introduced.

## Candidate files

Before linting, require `candidate`, `candidate/.github` and
`candidate/.github/workflows` to be real non-symlink directories. Every matched
`.yml` or `.yaml` entry must be a regular non-symlink file. Fail on directory,
FIFO, dangling or ordinary symbolic links before invoking actionlint. Keep
hidden files, spaces in names, both extensions, absent-file failure and linter
error propagation. Lint each admitted file through standard input with actionlint's
default `<stdin>` filename and the trusted empty config. Do not set
`-stdin-filename` to a real candidate path: that re-enables candidate project
discovery and local action/reusable-workflow metadata reads. This hygiene lane
validates workflow syntax and built-in semantics, not local action metadata.
Report the source filename separately with control characters safely escaped.

## Caller and candidate checkout

Admit `pull_request_target` and main `push` only. Validate the positive PR number,
positive repository IDs and exact nonzero head/base SHAs from the GitHub event.
For PRs, both head/base repository IDs and full names must equal the current
repository. Always retrieve from `github.repository`:
use `refs/pull/<event number>/head` for PRs and the exact event SHA for pushes.
Retain full history, disabled persisted credentials and immediate exact HEAD
verification. A moving PR ref fails; it never changes the accepted target SHA.

The pinned checkout action blocks fork PR data in target events by default.
Retain this guard without `allow-unsafe-pr-checkout` or alternative downloaders.
V1 supports branches within the same repository, matching current merge admission
and the existing callers. Reject foreign and private-fork heads explicitly during
admission, before attempting a checkout with an insufficient token. This narrows
the original speculative cross-repository admission; it does not claim to add
private-fork support. Fork enablement needs a separately reviewed policy decision
and live authentication evidence. Same-repository branches in public or private
repositories retain the existing read token and never need extra credentials.
An applicable organization event policy must allow the event before enrollment;
do not modify that policy here.

## Caller rollout

Each product keeps its original `Repository baseline` required job unchanged.
Move only the new `trusted-baseline` job into a separate inert
`.github/workflows/trusted-baseline.yml` wrapper, with target events and main
push, read-only contents permission, a full immutable shared SHA, no inputs,
secrets or executable steps. Preserve existing manual-dispatch behavior.

The new wrapper is absent from main, so this bootstrap PR cannot establish a
base-owned target run. Existing required CI, independent review and current-head
native code-owner approval remain the delivery conditions. After normal merge,
observe main push and a subsequent qualification PR before recording producer
identity or adding the new required check. Do not claim a candidate-owned run as
that evidence. Exact current-head/base checks in the controller stay unchanged.

## Acceptance and evidence limits

1. Execute the real workflow shell blocks against ordinary and hidden/space-name
   files, both extensions, leaf/ancestor/dangling symlinks and nonregular entries.
   Demonstrate the original linter acceptance no longer reproduces.
2. Admit valid target and main-push events; reject candidate-owned PR events,
   malformed PR numbers, repositories and SHAs; reject public/private forks and
   mismatched or missing repository IDs. Assert checkout repository/ref,
   absence of unsafe opt-ins and persisted-credential settings.
3. Retrieve a local PR ref from a base repository with head absent from its main
   branch; accept exact head, reject a subsequently moved ref. This establishes
   Git/ref behavior, not live private-repository authentication.
4. Run required package, workflow lint, shell/Node syntax, whitespace and secret
   checks; independently review the complete candidate patch. Obtain fresh native
   Code Review and Security Review on the final head and inspect their results.
5. Report current CI, deliberately unsupported fork PRs, pending target
   bootstrap/producer qualification and pending native approval separately.

The previous candidate-owned CI success remains historical evidence only.
Neither model review nor a successful hygiene check authorizes automatic merge.
