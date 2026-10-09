# CodeQL admission follow-up

Status: proposed for independent review. Candidate base: `b5df6ff3dbdf210ed9de5acb92a91e93c99d706c`.

## Observed blocker

PR #24 run `37872379703` passes isolated verification and JavaScript CodeQL but
its Actions SARIF gate reports one finding. The repository's existing open
alert #1 on main `700dacb7` is `actions/untrusted-checkout/critical`; main analysis
`1866142712` provides the code flow from the exact candidate checkout to the
trusted authority guard invocation in `.github/workflows/ci.yml:106-110`.
PR-filtered API results do not expose that unchanged baseline finding and are
not evidence that raw SARIF is empty.

The current `verify` job rejects different head repositories before the CodeQL
job can run, but performs that check in a shell body using environment values.
CodeQL's control-check model recognizes a repository comparison in a native
workflow condition. The existing separate PR #21 changes the guard invocation;
its last run also fails Actions CodeQL and is not adopted by this follow-up.

## Narrow design change

Add a native condition to the existing `codeql` job that permits only a `push`
event or a `pull_request_target` event whose head repository equals
`github.repository`. Retain `needs: verify`, so the existing membership/bot
admission and all verification must still pass. Invalid PR context makes the
job skipped and the required aggregate fails; it does not become successful.

This condition repeats an existing enforced restriction at the privileged job's
boundary. It grants no new authority and does not remove the existing shell
admission, trusted external guard, approved SARIF validator, exact candidate
checkout, language matrix, source root, permissions or required gate.

This addendum permits only that condition and its regression evidence as an
exception to the original spec's promise not to edit central CI. No query,
SARIF result, alert, required check or evaluation threshold is suppressed or
changed. No unrelated PR is merged or modified.

## Acceptance

- Bind a truth-table regression to the actual job condition: main push and
  same-repository PR are eligible; fork, missing PR head and unsupported events
  are ineligible. Existing verification and both CodeQL lanes remain required.
- Run the full local unit suite, all-workflow actionlint, shell/Node syntax,
  Gitleaks and diff checks.
- Analyze the new candidate through the existing base-owned GitHub workflow.
  Require successful raw Actions and JavaScript SARIF gates before merge.
- If the finding persists, keep the required gate blocked and diagnose the
  remaining raw result. Do not substitute API alert counts for the raw gate.
