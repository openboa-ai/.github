# Baseline whitespace check: binary blob handling addendum

## Intent and boundaries

Preserve full whitespace enforcement on text files and full text-patch scanning
for historical secret detection in `.github/workflows/repository-baseline.yml`
without false-failing legitimate binary assets (such as images and vendored
archives).

This addendum applies only to the `Verify candidate identity and whitespace`
step in `.github/workflows/repository-baseline.yml`. It introduces no new
permissions, credentials, inputs, outputs, secrets, candidate execution, or
policy exemptions.

## Allowed and prohibited behavior

- **Whitespace verification:** Set
  `* !diff whitespace=blank-at-eol,blank-at-eof,space-before-tab` in
  `candidate/.git/info/attributes` before running
  `git -C candidate diff --check --no-ext-diff --no-textconv`.
  - Because `.git/info/attributes` has higher precedence than repository
    `.gitattributes`, candidate `-diff`, `binary`, and `-whitespace` attributes
    are overridden and cannot suppress whitespace checks on text files.
  - Because `!diff` resets `diff` to the unspecified state instead of forcing
    `diff` (text mode), Git's native NUL-byte binary detection skips genuine
    binary blobs (`.jpg`, `.png`, `.tgz`, etc.) during whitespace checking.
- **History secret scanning:** Immediately after `git diff --check` succeeds,
  set `* diff` in `candidate/.git/info/attributes` before the subsequent
  `gitleaks git` and `gitleaks dir` scans so neither candidate `.gitattributes`
  nor NUL bytes can hide deleted credentials in commit history.
- **Prohibited:** Candidate `.gitattributes` rules must never suppress text
  whitespace checks or hide deleted credentials from `gitleaks git`.

## Acceptance evidence

1. Existing regression tests in `scripts/test-ci-boundary.mjs` and
   `scripts/test-baseline-gitleaks.mjs` pass unchanged (candidate
   `* -diff -whitespace` and `* binary -whitespace` still fail whitespace checks
   on text files and still fail `gitleaks git` on deleted credentials).
2. New regression test in `scripts/test-ci-boundary.mjs` proves that genuine
   NUL-byte binary payloads containing trailing spaces/tabs pass
   `git diff --check`, that text files with trailing whitespace in the same
   commit still fail even with candidate `.gitattributes` overrides, and that
   `candidate/.git/info/attributes` ends with `* diff` for history scanning.
3. All required central repository checks (`npm test`, `actionlint`,
   `sh -n .github/scripts/*.sh`, `node --check .github/scripts/*.mjs`,
   `git diff --check`) pass on the head commit.
