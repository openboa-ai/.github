import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function auditSettings(repository, { rulesets, environment, actions }) {
  const issues = [];
  const active = rulesets.filter((rule) => rule.enforcement === "active" &&
    rule.conditions?.ref_name?.include?.some((ref) => ref === "~DEFAULT_BRANCH" || ref === "refs/heads/main"));
  if (!active.length) issues.push("No active ruleset protects main.");
  const rules = active.flatMap((set) => set.rules ?? []);
  for (const type of ["deletion", "non_fast_forward", "required_linear_history"]) {
    if (!rules.some((rule) => rule.type === type)) issues.push("Missing protection: " + type);
  }
  const pull = rules.find((rule) => rule.type === "pull_request")?.parameters;
  if (!pull?.require_code_owner_review) issues.push("Independent CODEOWNERS review is not required.");
  if (!pull?.dismiss_stale_reviews_on_push) issues.push("Stale approvals are not dismissed.");
  if (!pull?.required_review_thread_resolution) issues.push("Review thread resolution is not required.");
  const checks = rules.find((rule) => rule.type === "required_status_checks")?.parameters;
  const context = repository === ".github" ? "Organization controls verification" : "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required";
  if (!checks?.strict_required_status_checks_policy) issues.push("Required checks do not require an up-to-date branch.");
  if (!checks?.required_status_checks?.some((check) => check.context === context && check.integration_id === 15368)) issues.push("Required check/source is missing: " + context);
  if (active.some((rule) => rule.bypass_actors?.length)) issues.push("Ruleset has bypass actors; explicit exception review is needed.");
  if (repository !== ".github") {
    const reviewers = environment?.protection_rules?.find((rule) => rule.type === "required_reviewers")?.reviewers ?? [];
    if (!reviewers.length) issues.push("coffee-security has no required reviewers.");
  }
  if (actions.default_workflow_permissions !== "read") issues.push("Default workflow token is not read-only.");
  if (actions.can_approve_pull_request_reviews !== false) issues.push("Actions are allowed to approve pull requests.");
  return { repository, issues, preservedAdditionalRules: rules.filter((rule) => /coverage|code_quality/u.test(rule.type)).map((rule) => rule.type) };
}

async function main() {
  const repositories = process.argv.slice(2);
  if (!repositories.length) repositories.push(".github", "coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench");
  const api = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const reports = [];
  for (const repository of repositories) {
    if (![".github", "coffee-chat", "coffee-chat-roastery", "coffee-chat-eval", "coffee-chat-bench"].includes(repository)) throw Error("Unsupported repository");
    const prefix = "repos/openboa-ai/" + repository;
    try {
      const entries = api(prefix + "/rulesets?includes_parents=true");
      const rulesets = entries.map((entry) => api(prefix + "/rulesets/" + entry.id));
      const environment = repository === ".github" ? null : api(prefix + "/environments/coffee-security");
      const actions = api(prefix + "/actions/permissions/workflow");
      reports.push(auditSettings(repository, { rulesets, environment, actions }));
    } catch { reports.push({ repository, issues: ["Live settings could not be fully read; not verified."] }); }
  }
  console.log(JSON.stringify(reports, null, 2));
  if (reports.some((report) => report.issues.length)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
