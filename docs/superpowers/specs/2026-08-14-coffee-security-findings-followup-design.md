# Coffee repositories security-scan follow-up design

## Goal

Close the validated Codex Security findings in the four Coffee repositories
without turning routine solo-maintainer maintenance into a blanket manual-review
process. Human confirmation remains reserved for executable or trust-boundary
changes. Exact in-repository Dependabot dependency updates remain eligible for
native auto-merge after the trusted central checks pass.

## Validated findings

The four repositories accept candidate-controlled `package-lock.json` changes
as ordinary changes. Their structural policy checks validate direct dependency
names, registry URLs, integrity syntax, and lifecycle-script restrictions, but
do not authenticate the complete dependency graph or package `bin` ownership.
An admitted same-repository agent can therefore add a reachable transitive
package with a colliding `prettier` or `tsc` binary. `npm ci --ignore-scripts`
still links binaries and the required quality lane then executes the collision.

Eval additionally treats PCDA calibration fixtures as ordinary data even though
the required `pcda:calibrate` command uses them as acceptance evidence. The
receipt builder checks only rewards and non-empty agent metadata, not exact
Oracle and no-op roles. Its protocol-canary image also installs an unused Codex
package online without an authenticated artifact graph.

Bench treats its executable Prettier configuration and tests as ordinary paths,
so candidate JavaScript can enter the required and local verification paths
without the selective `coffee-security` review.

## Security model

The trusted reusable workflow remains the only merge-authorization lane. A
candidate is admitted only when the actor is the same in-repository
OWNER/MEMBER who authored the pull request, or the exact in-repository
`dependabot[bot]` identity. Organization controls, base policy, secret scanning,
dependency review, CodeQL, and classification are trusted; candidate quality is
credential-minimized and runs only after authorization and any required
Environment confirmation.

Package manifests and root lockfiles are executable supply-chain authority, so
they become protected paths in every repository. The central classifier grants
one narrow exception: when actor and author are both `dependabot[bot]`, the head
repository equals the base repository, exact base policy succeeds, and every
protected change is exactly `package.json` or `package-lock.json`, those two
paths do not trigger the Environment. Any policy failure or any additional
protected path remains sensitive.

The central quality runner adds defense in depth. Root and policy-parser
installs use `--ignore-scripts --no-bin-links`; candidate `npm run` indirection
is removed; and every required command invokes the expected direct Node,
Prettier, TypeScript, Python, shell, or Git entrypoint explicitly. This prevents
a lockfile `bin` collision from selecting the command even if classification or
repository policy later regresses.

## Repository changes

- Coffee, Roastery, Eval, and Bench add `/package.json` and
  `/package-lock.json` (or their normalized equivalents) to the exact protected
  path manifest. CODEOWNERS is aligned where present; the Environment, rather
  than CODEOWNERS approval count, remains the enforcement boundary.
- Each structural policy test locks the package paths into the protected
  manifest and verifies that weakening them fails closed.
- Eval protects `tests/fixtures/pcda-calibration/**`, requires exact distinct
  `oracle` and `nop` identities when constructing the acceptance receipt, and
  removes the unused online Codex installation from the protocol-canary image.
- Bench protects `/prettier.config.mjs` and `/tests/**` and aligns its policy,
  CODEOWNERS, and solo-maintainer guidance.
- Existing routine minor/patch Dependabot grouping, security-update grouping,
  zero global approvals, and the one trusted required context remain intact.

## Considered alternatives

Protecting every dependency update without an exception is simple but violates
the requested lifecycle by forcing routine Dependabot maintenance through the
Environment. Relying only on a complete npm graph validator would be brittle:
npm lock semantics, optional/platform edges, and binary ownership evolve, while
the candidate still selects registry artifacts. Keeping package files ordinary
and adding only `--no-bin-links` protects the hosted runner but still lets a
malicious lockfile persist to `main` and later affect a maintainer's normal local
install. The selected design combines a narrow identity-bound automation
exception with persistent-path protection and independent execution hardening.

## Verification and rollout

Every change starts with a failing regression test. The organization controls
are merged first so target wrappers can pin the final immutable SHA. Each target
then receives a repository-specific pull request, full install/audit/policy/test
verification, and native auto-merge configuration. Security PRs may traverse
the existing `coffee-security` Environment; the already-authorized solo
maintainer confirmation is applied without stopping for an additional prompt.
After merge, live rulesets, required-workflow identity, Environment behavior,
Dependabot configuration, alerts, and open pull requests are re-read. Finally,
all four merged revisions receive fresh authoritative Codex Security scans.
