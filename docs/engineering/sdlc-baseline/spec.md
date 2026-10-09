# Shared repository baseline workflow

Status: proposed for independent review. Base: `700dacb7d811a080cb49bb4a81a9d5f437d697fd`.

## Intent and scope

Provide an additive, reusable baseline for repositories that have no product
build contract yet. It checks workflow syntax, whitespace and secrets without
executing candidate programs. A successful baseline is not product validation,
independent review, merge authorization or deployment evidence.

The existing Coffee trusted gate, central CI, environment approval, required
checks and policy implementation remain unchanged. Update the central workflow
inventory test to admit exactly this additional reusable workflow; do not admit
another automatically triggered central workflow. Existing callers and their
immutable revisions continue to work.

## Interface and authority

- Add `.github/workflows/repository-baseline.yml`, named `OpenBoa repository
  baseline`, with only `workflow_call` and no inputs, secrets or outputs.
- Its only job has ID `baseline` and name `Trusted repository baseline`.
  Callers pin the reusable workflow to a full reviewed commit SHA. Callers use
  job ID and name `trusted-baseline`; the expected check name is
  `trusted-baseline / Trusted repository baseline`, subject to live API
  verification before enabling a required check.
- Admit only `pull_request` and pushes to `refs/heads/main`. All other events
  fail. A caller that also has manual dispatch must omit this job for dispatch.
- Take repository identity and exact head/base commits exclusively from GitHub
  event context. Validate required fields before checkout. For a PR, require
  its base repository to equal the caller repository and permit the event's
  head repository; for main push, use the caller repository and `before`/`sha`.
- Run on `ubuntu-24.04` with a bounded timeout and `contents: read` only.
  Every checkout disables persisted credentials. No candidate-owned scripts,
  package managers, product builds, dynamic shell input, deployment, OIDC or
  security-event writing are introduced.
- Tools come from the existing reviewed controls commit
  `700dacb7d811a080cb49bb4a81a9d5f437d697fd`, not the candidate or caller input.
  Retain full action pins and checksum-verifying installers.

## Verification behavior and failures

- Check out controls and candidate into distinct directories. Check the exact
  candidate HEAD against the event SHA before examining files.
- Run trusted actionlint over both `.yml` and `.yaml` workflow files, including
  hidden files and names containing whitespace, without candidate configuration
  or optional shell/Python subprocess linters. Missing workflows fail.
- Check whitespace over the PR base-to-head diff or main push before-to-head
  diff. Fetch an absent base only from the validated caller repository. The
  all-zero `before` of an initial push uses the Git empty tree. Non-initial
  missing commits and deleted main fail rather than silently skipping checks.
- Scan candidate Git history and its checked-out directory using the trusted
  Gitleaks config, `/dev/null` ignore path, ignored inline allow directives and
  redacted output. Scanner or installer failure fails the job.
- Do not add success aggregation that converts a skipped, failed or cancelled
  check into a pass. Workflow/run identity is supplied by GitHub, never a
  candidate-generated result file. The controller must separately verify run
  event, repository, workflow path/revision and target commits.

## Acceptance evidence

1. Existing central and Coffee policy tests pass unchanged except the explicit
   workflow inventory addition. No old executable controls or required names
   change.
2. Fixture tests execute actual workflow shell blocks: reject unsupported event,
   malformed/missing SHAs, wrong PR base repository and non-main push; accept
   valid PR and main push contexts.
3. Lint fixtures cover both extensions, hidden files, whitespace paths, no
   workflow files and nonzero linter exit propagation.
4. Temporary Git fixtures cover clean and whitespace-invalid diffs, initial
   push, head mismatch and unavailable base.
5. `npm test`, actionlint over all workflow extensions, shell/Node syntax checks
   and `git diff --check` pass. Real trusted central CI and a pinned product
   caller run are separate remote rollout evidence, not claimed by fixtures.

## Rollout and compatibility

Land through a reviewed central PR under its existing protection. Add the pinned
caller job alongside each repository's existing `Repository baseline` gate.
Keep existing required gates until live identity and positive/negative behavior
are verified. Policy adoption and rollout across callers are separate changes;
this commit grants no authority to bypass required checks or human review.
