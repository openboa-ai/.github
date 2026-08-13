# OpenBoa organization control rules

This repository owns organization-wide GitHub policy and required workflow
definitions. Treat every executable or policy file as a sensitive control.

- Target repository changes use pull requests. Routine changes remain eligible
  for native auto-merge; protected paths and policy evolution pause at the
  `coffee-security` GitHub Environment for the solo maintainer's confirmation.
- Required workflows execute pull-request content only as inert data. Controls
  and parsers must come from the required workflow SHA or the target base SHA.
- Target repositories must not define automatic workflow YAML. Authorization,
  secret scanning, dependency review, CodeQL, and deterministic quality belong
  to this organization-owned required workflow.
- Do not add secrets, OIDC, package publishing, deployment, or write-token
  permissions. The only write permission is `security-events: write` in the
  trusted CodeQL job.
- Do not enable merge queue. Routine auto-merge applies in the target Coffee
  repositories only after this trusted workflow and their normal CI pass.
- Eval Harbor calibration runs on a fresh runner before any candidate program,
  from its complete hash-locked dependency graph.
- Run `npm test`, `actionlint .github/workflows/*.yml`, `sh -n
  .github/scripts/*.sh`, `node --check .github/scripts/*.mjs`, and
  `git diff --check` before merging.
