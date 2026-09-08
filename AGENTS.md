# OpenBoa organization control rules

This repository owns organization-wide GitHub policy and required workflow
definitions. Treat every executable or policy file as a sensitive control.

- Target repository changes use pull requests. Routine changes remain eligible
  for native auto-merge; protected paths and policy evolution pause at the
  `coffee-security` GitHub Environment for the solo maintainer's confirmation.
- Authorization and security jobs treat pull-request content only as inert data.
  Controls and parsers come from the pinned workflow SHA or the target base SHA.
  Repository-owned verification runs only through the trusted launcher in a
  separate non-root container without a network, host mounts, credentials,
  runner command files, shared privileged caches, or Docker socket.
- Target repositories define one exact `pull_request_target` wrapper containing
  no executable steps. It calls this organization-owned reusable workflow by a
  full commit SHA. Central code owns authorization, secret scanning, dependency
  review, CodeQL and execution isolation; repositories own npm run verify.
  Keep the required aggregate name and all protected paths. Policy failures
  fail the run; approval never converts them to success.
- Do not add secrets, OIDC, package publishing, deployment, or write-token
  permissions. The only write permission is `security-events: write` in the
  trusted CodeQL job.
- Do not enable merge queue. Routine auto-merge applies in the target Coffee
  repositories only after this trusted workflow and their normal CI pass.
- Product/evaluator-specific tests and calibration belong to their repository.
  Do not restore historical product dispatchers or report structural checks as
  a calibration, benchmark result, or Product lift.
- Central PR changes also run through base-owned isolation. The initial rollout
  needs owner-reviewed local evidence because the old base has no self-CI.
  Never bypass old required checks to bootstrap a new pin without a scoped,
  expiring exception identifying the exact base, head and compensating checks.
- Run `npm test`, `actionlint` (all workflow extensions), `sh -n
  .github/scripts/*.sh`, `node --check .github/scripts/*.mjs`, and
  `git diff --check` before merging.
