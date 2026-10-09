# Local implementation evidence

Date: 2026-10-09. Accepted specification revision: `071a9bc`.

| Check | Observed result |
| --- | --- |
| `npm test` | 41 tests: 40 passed, 1 existing Linux-only test skipped on macOS |
| actionlint 1.7.12 | All three workflows passed; binary archive checksum verified by the pinned installer |
| Shell and Node syntax | All shell control scripts and JavaScript control/test scripts passed |
| `git diff --check` | Passed |
| Gitleaks 8.30.1, working directory | No leaks found using the checksum-verified trusted config, no candidate ignore file or inline allows |
| Gitleaks 8.30.1, Git history | 43 committed revisions scanned; no leaks found with the same trusted configuration |
| Real actionlint regression | Nine cases passed: ordinary/hidden/space-name workflows, leaf and parent links, dangling links, directories, FIFOs, outside action metadata and invalid runner labels with candidate ignore-all config |
| Real Gitleaks deleted-history fixtures | Both `-diff` and `binary` candidate attributes failed to hide a deleted synthetic credential; directory-only scans passed, trusted history scans rejected the credential with redacted output |

The new tests execute the workflow's actual shell blocks for event admission,
both workflow file extensions, missing workflows, exact head/base whitespace
validation, initial main push, candidate attribute override, unavailable base
and both scanner failure paths. Scanner command tests use stubs; the separate
local Gitleaks checks above used the installed version, not the Linux runner
binary. Whitespace fixtures use real temporary Git repositories; their network
fetch failure is intentionally stubbed.

An admission fixture caught differing `errexit` behavior inside `case` on the
local Bash version. Every admission predicate now explicitly exits on failure.

Independent review found that the first candidate (`a770010`) only overrode
whitespace attributes. A candidate could still select binary diffs and suppress
both whitespace diagnostics and historical credential scanning. Real Git and
Gitleaks fixtures reproduced the bypass on that candidate. The corrected
workflow forces text patches through trusted Git info attributes before both
checks. Tests cover root and nested candidate attributes, both `-diff` and the
`binary` macro, and a credential removed from the final working tree. The
synthetic credential is generated locally and is never issued by a provider.

## Central CodeQL admission follow-up

[PR #24 run 37872379703](https://github.com/openboa-ai/.github/actions/runs/37872379703)
on `b5df6ff` passed trusted isolated verification and JavaScript CodeQL. The
Actions raw SARIF gate rejected one finding. The approved follow-up in
`codeql-admission-addendum.md` adds a native same-repository event condition to
the CodeQL job and keeps the existing guard and result evaluator unchanged.
Its source-bound truth table, full unit suite, actionlint, syntax, working-tree
secret scan and diff checks passed locally.
[Run 37873356831](https://github.com/openboa-ai/.github/actions/runs/37873356831)
on `04b282e50ed07ebf4ddb467dac95c2f7222f199e` subsequently passed isolated
verification, both raw CodeQL gates and the required aggregate.

## Candidate data and caller provenance remediation

Review of `04b282e` found that linting a candidate workflow symlink could instead
validate a controls file. Real actionlint reproduced successful linting through
a workflow leaf link, a `.github` link and a `workflows` link. The remediation
rejects these paths before any linter invocation, along with dangling links,
directories and FIFOs. Unit fixtures also cover a redirected candidate root.

A second fixture uses a regular workflow referring to a local action directory
symlink outside the candidate. File-based linting and stdin with a candidate
filename both printed a synthetic outside-metadata marker. The corrected actual
step uses default stdin identity and does not read that metadata. Normal workflows
still pass and an invalid built-in runner still fails despite candidate ignore
configuration. This lane checks syntax and built-in semantics; it does not claim
local action metadata validation.

Event tests now accept only main push or same-repository target PRs with matching
positive repository IDs and names. Invalid PR numbers and foreign/private-fork
heads fail before checkout. A local Git fixture retrieves the PR ref from the
base repository when its head is absent from main, then verifies the exact event
head. Moving the ref causes rejection. This establishes Git/ref behavior, not
live private-repository authentication. No unsafe checkout opt-in was added.

These changes follow the accepted remediation addendum. Current-head native
review and CI must run again after publication; earlier passes do not attest
to the remediation candidate.

## Unverified delivery states

- PR #24 and CI success at `04b282e` are established; this record does not
  establish approval, merge or CI success on the remediation candidate.
- The Docker daemon was unavailable. Real container isolation was not exercised
  locally; the trusted launcher is unchanged and the central workflow change is
  limited to the accepted native admission condition.
- The new inert target caller must land normally before a subsequent PR can
  establish its base-owned run identity, exact referenced revision and required
  job name. Existing required checks and native owner review remain in place
  during bootstrap; producer qualification and organization event-policy
  admission remain prerequisites for enrollment.
- Fork PRs are deliberately unsupported. Same-repository private authentication
  is not established by the local Git fixture.
- This baseline provides no product build, evaluation or deployment evidence.
