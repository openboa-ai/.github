# OpenBoa organization control rules

This repository owns organization-wide GitHub policy and required workflow
definitions. Treat every executable or policy file as a sensitive control.

- Changes use a pull request and require independent review from the
  `security-maintainers` team after the initial security bootstrap.
- Required workflows execute pull-request content only as inert data. Controls
  and parsers must come from the required workflow SHA or the target base SHA.
- Do not add secrets, OIDC, package publishing, deployment, or write-token
  permissions. The only write permission is `security-events: write` in the
  trusted CodeQL job.
- Do not enable merge queue. Routine auto-merge applies in the target Coffee
  repositories only after this trusted workflow and their normal CI pass.
- Run `npm test`, `actionlint .github/workflows/*.yml`, `sh -n
  .github/scripts/*.sh`, and `git diff --check` before merging.
