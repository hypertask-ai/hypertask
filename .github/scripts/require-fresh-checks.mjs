import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const RULESET_NAME = "production-required-checks";

function redact(text) {
  return String(text || "").replace(/ghs_[A-Za-z0-9_]+/g, "ghs_redacted").slice(0, 400);
}

export function checkPins(ruleset) {
  return (ruleset?.rules || [])
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters?.required_status_checks || []).map((check) => ({
      context: check.context,
      integration_id: Object.prototype.hasOwnProperty.call(check, "integration_id") ? check.integration_id : null,
    })))
    .sort((left, right) => left.context.localeCompare(right.context) || Number(left.integration_id) - Number(right.integration_id));
}

export function checksAreFresh(ruleset) {
  const rules = (ruleset?.rules || []).filter((rule) => rule.type === "required_status_checks");
  return rules.length === 1 && rules[0].parameters?.strict_required_status_checks_policy === true;
}

export function requireFreshChecks(ruleset) {
  if (!ruleset || ruleset.name !== RULESET_NAME) {
    throw new Error("Refusing to edit a ruleset that is not production-required-checks.");
  }
  if (ruleset.target !== "branch" || ruleset.enforcement !== "active") {
    throw new Error("Refusing to edit a ruleset that is not an active branch ruleset.");
  }
  const include = ruleset.conditions?.ref_name?.include;
  const exclude = ruleset.conditions?.ref_name?.exclude;
  if (!Array.isArray(include) || !include.includes("refs/heads/production")
      || !Array.isArray(exclude) || exclude.includes("refs/heads/production")) {
    throw new Error("Refusing to edit a ruleset that does not protect production.");
  }
  if (!Array.isArray(ruleset.rules) || ruleset.rules.length === 0) {
    throw new Error("Refusing to edit a ruleset with no rules.");
  }
  let seen = 0;
  const rules = ruleset.rules.map((rule) => {
    if (rule.type !== "required_status_checks") return structuredClone(rule);
    seen += 1;
    const parameters = rule.parameters || {};
    if (parameters.do_not_enforce_on_create !== false) {
      throw new Error("Refusing to edit create enforcement.");
    }
    const checks = parameters.required_status_checks;
    if (!Array.isArray(checks) || checks.length === 0) {
      throw new Error("Refusing to write an empty required-check list.");
    }
    return {
      type: "required_status_checks",
      parameters: {
        ...structuredClone(parameters),
        strict_required_status_checks_policy: true,
      },
    };
  });
  if (seen !== 1) throw new Error("Expected one required_status_checks rule.");
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    bypass_actors: Array.isArray(ruleset.bypass_actors) ? structuredClone(ruleset.bypass_actors) : [],
    conditions: structuredClone(ruleset.conditions),
    rules,
  };
}

export function planFreshChecks(ruleset) {
  const body = requireFreshChecks(ruleset);
  return { action: checksAreFresh(ruleset) ? "noop" : "put", body };
}

function ghJson(args, body) {
  const response = spawnSync("gh", ["api", ...args], {
    input: body,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  if (response.error) throw response.error;
  if (response.status !== 0) {
    throw new Error(`GitHub API failed (${response.status}): ${redact(response.stderr || response.stdout)}`);
  }
  if (!String(response.stdout || "").trim()) throw new Error("GitHub API returned an empty body.");
  return JSON.parse(response.stdout);
}

function rulesetId(repo) {
  const rulesets = ghJson([`repos/${repo}/rulesets?per_page=100`]);
  const matches = rulesets.filter((ruleset) => ruleset.name === RULESET_NAME && ruleset.enforcement === "active");
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) {
    throw new Error("Expected one active production-required-checks ruleset.");
  }
  return matches[0].id;
}

function readRuleset(repo, id) {
  return ghJson([`repos/${repo}/rulesets/${id}`]);
}

function pinsMatch(ruleset, expected) {
  return JSON.stringify(checkPins(ruleset)) === JSON.stringify(expected);
}

function putFresh(repo, id, body, beforePins) {
  ghJson(["--method", "PUT", "--input", "-", `repos/${repo}/rulesets/${id}`], JSON.stringify(body));
  const after = readRuleset(repo, id);
  if (checksAreFresh(after) && pinsMatch(after, beforePins)) return;
  ghJson(["--method", "PUT", "--input", "-", `repos/${repo}/rulesets/${id}`], JSON.stringify(body));
  const retry = readRuleset(repo, id);
  if (!checksAreFresh(retry) || !pinsMatch(retry, beforePins)) {
    throw new Error("Ruleset write did not keep fresh checks and the previous check pins.");
  }
}

function assertLive(ruleset) {
  const pins = checkPins(ruleset);
  const tests = pins.find((pin) => pin.context === "ci-tests");
  const premerge = pins.find((pin) => pin.context === "premerge-evidence");
  if (!checksAreFresh(ruleset) || !tests || tests.integration_id !== 15368 || !premerge || premerge.integration_id !== null) {
    throw new Error("Fresh checks are not required.");
  }
}

function repoName() {
  const repo = process.env.REPO || "hypertask-ai/hypertask";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Missing or invalid REPO.");
  return repo;
}

function checkLive() {
  const repo = repoName();
  assertLive(readRuleset(repo, rulesetId(repo)));
  console.log("LIVE_FRESH_CHECKS");
}

function applyLive() {
  if (process.env.APPLY_FRESH_CHECKS !== "1") {
    throw new Error("Refusing to edit the ruleset without APPLY_FRESH_CHECKS=1.");
  }
  const repo = repoName();
  const id = rulesetId(repo);
  const current = readRuleset(repo, id);
  const plan = planFreshChecks(current);
  const beforePins = checkPins(current);
  if (plan.action === "noop") {
    assertLive(current);
    console.log("Fresh checks already required. No ruleset write.");
    return;
  }
  putFresh(repo, id, plan.body, beforePins);
  console.log("Fresh checks required. Existing check pins unchanged.");
}

function isDirectRun() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  try {
    if (process.argv[2] === "--check") checkLive();
    else applyLive();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
