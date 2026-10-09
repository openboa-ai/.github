# Local implementation evidence

Date: 2026-10-09. Accepted specification revision: `071a9bc`.

| Check | Observed result |
| --- | --- |
| `npm test` | 37 tests: 36 passed, 1 existing Linux-only test skipped on macOS |
| actionlint 1.7.12 | All three workflows passed; binary archive checksum verified by the pinned installer |
| Shell and Node syntax | All shell control scripts and JavaScript control/test scripts passed |
| `git diff --check` | Passed |
| Gitleaks 8.30.1, working directory | No leaks found using the checksum-verified trusted config, no candidate ignore file or inline allows |
| Gitleaks 8.30.1, Git history | 43 committed revisions scanned; no leaks found with the same trusted configuration |
| Real actionlint override fixture | An invalid runner label failed despite a candidate ignore-all config; correcting the runner passed |

The new tests execute the workflow's actual shell blocks for event admission,
both workflow file extensions, missing workflows, exact head/base whitespace
validation, initial main push, candidate attribute override, unavailable base
and both scanner failure paths. Scanner command tests use stubs; the separate
local Gitleaks checks above used the installed version, not the Linux runner
binary. Whitespace fixtures use real temporary Git repositories; their network
fetch failure is intentionally stubbed.

An admission fixture caught differing `errexit` behavior inside `case` on the
local Bash version. Every admission predicate now explicitly exits on failure.

## Unverified delivery states

- No push, pull request, GitHub CI, approval, merge, caller upgrade or protection
  change is established by this record.
- The Docker daemon was unavailable. Real container isolation was not exercised
  locally; the pre-existing trusted launcher and central workflow are unchanged.
- GitHub run identity, the reusable workflow's reported revision and the full
  `trusted-baseline / Trusted repository baseline` check name require a real
  pinned caller run before activation.
- This baseline provides no product build, evaluation or deployment evidence.
