# Solo-agent SDLC: proposed successor

Status: design draft, not a deployed policy. This document proposes a workflow
for one accountable owner using implementation and review agents. It changes no
workflow, permission, required check, CODEOWNERS route, or approval gate.
[AGENTS.md](../AGENTS.md), [SECURITY.md](../SECURITY.md), current executable
controls, and effective GitHub rules continue to govern changes. Migration needs
a separately reviewed implementation and observed enforcement evidence.

## Current contract and proposed outcome

Current controls use immutable workflow references, trusted base-owned policy,
isolated candidate execution, required results, and an owner confirmation gate
for protected changes. A check name, a policy file, or two account handles alone
does not prove independent review or effective enforcement.

The proposed routine path has zero ordinary human-review approvals only after an
authoritative gate can enforce the contract below. A second account controlled
by the same owner is not an independent reviewer and is not a prerequisite.
Implementation and review sessions have separate contexts and authority. Their
agreement remains fallible evidence, never permission to merge.

Protected, high-impact changes require one explicit confirmation from the owner
for the concrete base, head, scope, and intended action. This includes changes to
security controls, execution boundaries, credentials, access, protections,
release or deployment authority, and destructive operations. Confirmation cannot
turn a failed policy or missing verification into success. If the protected
candidate's base, head, scope, or intended action changes, refresh its evidence
and obtain confirmation for that new concrete proposal.

## Proposed implementation and review boundary

1. The implementation agent works in an isolated branch or worktree and produces
   a bounded patch with relevant tests and documented limitations.
2. A trusted launcher records the exact base/head commit IDs and plain diff
   digest. The reviewer starts in a fresh context, outside the candidate checkout
   in a trusted empty directory. Additional source excerpts are explicit inert
   inputs tied to the same commits, not an invitation to execute the repository.
3. A credential-bearing reviewer must not discover or load candidate configs,
   hooks, skills, plugins, MCP servers, instruction files, or executable helpers.
   Candidate prose is data, including instructions embedded in the diff. Trusted
   launcher configuration limits tools, filesystem access, network, and inherited
   environment; read-only mode alone is not a credential isolation boundary.
4. Candidate tests run separately without reviewer credentials, inherited agent
   configuration, host secrets, or merge authority. The reviewer identifies
   concrete findings, evidence, and unverified areas. The implementing agent fixes
   findings; relevant checks and a fresh review cover the resulting candidate.
5. A separate trusted gate verifies exact-head tests, policy results, and review
   provenance before evaluating merge eligibility. The candidate and reviewer
   cannot publish their own authoritative success. A model's exit code, approval
   sentence, or agreement with another model is insufficient.

This separation is our proposed design. OpenAI recommends relevant testing and
review; Anthropic describes fresh-context writer/reviewer sessions to reduce
shared implementation assumptions. Neither recommendation establishes our merge
authority or guarantees correctness. See [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
and [Claude Code best practices](https://code.claude.com/docs/en/best-practices).

## Authentication and launcher constraints

Keep local subscription authentication local. Do not copy subscription login
files or tokens into public GitHub Actions, artifacts, prompts, or repository
secrets. OpenAI's account-auth CI guidance excludes public/open-source
repositories. Its Action guidance also warns that read-only operation alone does
not protect secrets, recommends dropping sudo or using an unprivileged user, and
places Codex last within its job. This proposal installs no model Action and
creates no new authentication path. See [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Codex GitHub Action privileges](https://learn.chatgpt.com/docs/github-action).

Claude Code's non-interactive mode can trust repository settings and execute
hooks without an interactive trust prompt. Bare mode skips automatic discovery
but requires API/provider authentication rather than subscription OAuth, and
explicitly added directories can reintroduce skills. It is not a subscription
authentication workaround or a complete sandbox. See [workspace trust](https://code.claude.com/docs/en/hooks#workspace-trust),
[bare mode](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode),
and the [CLI reference](https://code.claude.com/docs/en/cli-reference).

Launcher validation must cover the installed version and effective configuration,
including hooks, inherited settings, tool access, and failure paths. For Claude's
sandbox, `failIfUnavailable: true` and `allowUnsandboxedCommands: false` prevent
two documented fallback paths, but merged `excludedCommands` entries can still
widen execution. Sandbox defaults also need explicit credential-read controls.
These are considerations for a future launcher, not a tested command recipe or
an instruction to install a tool. See [sandboxing limitations](https://code.claude.com/docs/en/sandboxing).

## Evidence and pending enforcement decisions

Each proposed evidence record binds repository, PR, exact base/head, trusted
control version, diff digest, reviewer/tool version and configuration, test and
scan results, unresolved findings, and relevant owner confirmation. A push,
base change, or control change invalidates affected evidence. Preserve the
original results; distinguish local checks, hosted checks, review, authorization,
merge, and post-merge observation.

GitHub documents November 2, 2026 enforcement of the default
`pull_request_target` blocking policy for affected public repositories already
using that default policy before general availability. Existing applicable event
policies are treated separately. Our proposed migration should assess actual
policy insights before that deadline and separate untrusted execution from
trusted authorization; it does not authorize a broad opt-out or unsafe PR
checkout. Any event change must preserve the authoritative producer boundary.
See [GitHub's policy and migration guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).

Before rollout, resolve these decisions with a synthetic pilot:

- **Authoritative producer:** prove who can create the required result and how
  the verifier rejects candidate-controlled workflows, stale commits, forged
  reports, skipped jobs, and missing results. A matching check name or shared
  GitHub Actions identity alone does not bind a result to trusted workflow code.
- **GitHub Free boundaries:** public repository rulesets and private repository
  protections have different plan availability. Inspect effective rules and
  bypass actors; do not infer enforcement from a checked-in declaration. Where
  enforcement is unavailable, exclude standing auto-merge and use a separately
  authorized exact-head decision. See [GitHub ruleset availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
  and [required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-status-checks-to-pass-before-merging).
- **Migration and rollback:** approve the successor contract before changing
  gates. Validate a small pilot without product data or real secrets, retain the
  prior control/settings snapshot, observe exact-head failures and successes,
  and define restoration before widening adoption. Do not remove an existing
  requirement to manufacture a passing migration.

Until these decisions are implemented and verified, the proposed zero-approval
routine path is not active. This document does not authorize payment, publicizing
private repositories, new credentials, or an expanded integration.
