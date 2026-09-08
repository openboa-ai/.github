# Security policy

Report a vulnerability privately through GitHub's **Security** tab by opening a
private vulnerability report. Do not include credentials or exploit details in
a public issue.

The `.github/workflows/coffee-trusted-gate.yml` workflow is an organization
trust boundary. Target repositories delegate automatic pull-request execution
to it. Routine changes may auto-merge only after every trusted lane succeeds;
protected paths and policy evolution additionally require the solo maintainer's
`coffee-security` GitHub Environment confirmation.

Candidate repositories supply only the exact inert trusted-workflow wrapper,
never candidate steps, alternate npm authority, or symlinked control data.
The target wrapper permits only `pull_request_target` and uses an immutable
control SHA. Organization-owned `.github/workflows/ci.yml` observes this central
repository's `main` branch through `push` after owner-reviewed initial landing.
It does not add automatic main-push verification to target repositories.

Authorization reads policy as data; it never imports repository validators.
Repository-owned npm run verify executes in a separate non-root, network-disabled
container. The trusted installer uses the locked public npm graph with lifecycle
scripts disabled. Neither stage receives host mounts, runner command files,
credentials, a Docker socket, or a privileged cache. Docker isolation does not
claim protection against a kernel or container-runtime vulnerability; use fresh
GitHub-hosted runners and keep the pinned runtime reviewed.

CODEOWNERS protects merge-time review, not pre-review workflow execution.
The execution boundary is enforced by the approved launcher, not by candidate
YAML permission declarations. Same-repository administrators remain trusted
GitHub control-plane principals; a check name alone is not a workflow identity.
