# Security policy

Report a vulnerability privately through GitHub's **Security** tab by opening a
private vulnerability report. Do not include credentials or exploit details in
a public issue.

The `.github/workflows/coffee-trusted-gate.yml` workflow is an organization
trust boundary. Target repositories delegate automatic pull-request execution
to it. Routine changes may auto-merge only after every trusted lane succeeds;
protected paths and policy evolution additionally require the solo maintainer's
`coffee-security` GitHub Environment confirmation.

Candidate repositories may supply only the exact inert trusted-workflow wrapper,
never candidate steps, alternate npm authority, or symlinked control data. Eval
Harbor calibration uses a fresh runner and an authenticated dependency graph so
earlier candidate tests cannot mutate it.
