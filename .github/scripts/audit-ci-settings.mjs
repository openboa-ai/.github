import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function auditSettings(repository, { branchRules, rulesets, environment, actions }) {
  const issues = [];
  // GitHub resolves include/exclude patterns, default-branch aliases and inherited
  // rules. Never infer effective protection from a ruleset's declarations.
  const rules = Array.isArray(branchRules) ? branchRules : [];
  if (!Array.isArray(branchRules)) issues.push("Effective main rules could not be verified.");
  if (!rules.length) issues.push("No active ruleset protects main.");
  const ids = [...new Set(rules.map((rule) => rule.ruleset_id))];
  const active = ids.map((id) => {
    const set = rulesets.find((entry) => entry.id === id && entry.enforcement === "active");
    if (!set || !Array.isArray(set.bypass_actors)) issues.push("Applicable ruleset details could not be verified: " + id);
    return set;
  }).filter(Boolean);
  for (const type of ["deletion", "non_fast_forward", "required_linear_history"]) {
    if (!rules.some((rule) => rule.type === type)) issues.push("Missing protection: " + type);
  }
  if (rules.some((rule) => rule.type === "merge_queue")) issues.push("Merge queue is enabled for main.");
  const pulls = rules.filter((rule) => rule.type === "pull_request").map((rule) => rule.parameters);
  if (!pulls.some((pull) => pull?.require_code_owner_review)) issues.push("Independent CODEOWNERS review is not required.");
  if (!pulls.some((pull) => pull?.dismiss_stale_reviews_on_push)) issues.push("Stale approvals are not dismissed.");
  if (!pulls.some((pull) => pull?.required_review_thread_resolution)) issues.push("Review thread resolution is not required.");
  const checks = rules.filter((rule) => rule.type === "required_status_checks").map((rule) => rule.parameters);
  const context = repository === ".github" ? "Organization controls verification" : "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required";
  if (!checks.some((check) => check?.strict_required_status_checks_policy && check.required_status_checks?.length)) issues.push("Required checks do not require an up-to-date branch.");
  if (!checks.some((set) => set?.required_status_checks?.some((check) => check.context === context && check.integration_id === 15368))) issues.push("Required check/source is missing: " + context);
  if (active.some((rule) => rule.bypass_actors?.length)) issues.push("Ruleset has bypass actors; explicit exception review is needed.");
  if (repository !== ".github") {
    const protectionRules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
    const required = protectionRules.filter((rule) => rule?.type === "required_reviewers");
    const reviewers = required.length === 1 && Array.isArray(required[0].reviewers) ? required[0].reviewers : [];
    if (!reviewers.length) issues.push("coffee-security has no required reviewers.");
    const login = reviewers[0]?.reviewer?.login;
    // GitHub accepts approval by any listed principal, so an additional user or
    // team would make the documented owner's confirmation optional.
    if (required.length !== 1 || reviewers.length !== 1 || reviewers[0]?.type !== "User" || typeof login !== "string" || login.toLowerCase() !== "sonsangjoon") {
      issues.push("coffee-security must require only User SonSangjoon.");
    }
    if (environment?.can_admins_bypass === true) issues.push("coffee-security allows administrator bypass.");
    else if (environment?.can_admins_bypass !== false) issues.push("coffee-security administrator bypass setting could not be verified.");
  }
  if (actions.default_workflow_permissions !== "read") issues.push("Default workflow token is not read-only.");
  if (actions.can_approve_pull_request_reviews !== false) issues.push("Actions are allowed to approve pull requests.");
  return { repository, issues, preservedAdditionalRules: rules.filter((rule) => /coverage|code_quality/u.test(rule.type)).map((rule) => rule.type) };
}

async function main() {
  const repositories = process.argv.slice(2);
  if (!repositories.length) repositories.push(".github", "coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench");
  const api = (path, paginated = false) => {
    const data = JSON.parse(execFileSync("gh", ["api", ...(paginated ? ["--paginate", "--slurp"] : []), path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    return paginated ? data.flat() : data;
  };
  const reports = [];
  for (const repository of repositories) {
    if (![".github", "coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench"].includes(repository)) throw Error("Unsupported repository");
    const prefix = "repos/openboa-ai/" + repository;
    try {
      const branchRules = api(prefix + "/rules/branches/main?per_page=100", true);
      const ids = [...new Set(branchRules.map((rule) => rule.ruleset_id))];
      const rulesets = ids.map((id) => api(prefix + "/rulesets/" + id));
      const environment = repository === ".github" ? null : api(prefix + "/environments/coffee-security");
      const actions = api(prefix + "/actions/permissions/workflow");
      reports.push(auditSettings(repository, { branchRules, rulesets, environment, actions }));
    } catch { reports.push({ repository, issues: ["Live settings could not be fully read; not verified."] }); }
  }
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((report) => report.issues.length)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
