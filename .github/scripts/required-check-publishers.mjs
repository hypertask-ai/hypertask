import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const APP = "https://app.hypertask.ai";
const BOARD = 11514;
const PR_LIMIT = 20;

export const TICKET_TITLE = "[INFRA] A required check has no publisher";
export const STALE_MINUTES = 240;
export const LOOKBACK_HOURS = 24;

export function requiredContexts(ruleset) {
  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  return [...new Set(rules
    .filter((rule) => rule?.type === "required_status_checks")
    .flatMap((rule) => (rule.parameters?.required_status_checks ?? []).map((check) => check.context))
    .filter((context) => typeof context === "string" && context.length > 0))];
}

export function observations(checkRuns, statuses) {
  const seen = [];
  for (const run of Array.isArray(checkRuns) ? checkRuns : []) {
    const at = Date.parse(run?.started_at ?? run?.completed_at);
    if (Number.isFinite(at) && typeof run?.name === "string" && run.name) seen.push({ context: run.name, at });
  }
  for (const status of Array.isArray(statuses) ? statuses : []) {
    const at = Date.parse(status?.created_at);
    if (Number.isFinite(at) && typeof status?.context === "string" && status.context) seen.push({ context: status.context, at });
  }
  return seen;
}

export function silentRequiredChecks({ required, seen, now, staleMinutes = STALE_MINUTES }) {
  const fresh = seen.filter((entry) => entry.at >= now - staleMinutes * 60_000);
  if (!fresh.length) return { judged: false, silent: [] };
  const alive = new Set(fresh.map((entry) => entry.context));
  return { judged: true, silent: required.filter((context) => !alive.has(context)) };
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function commentText(silent) {
  const items = silent.map((context) => `<li><p>${escapeHtml(context)}</p></li>`).join("");
  return `<p>These required checks published no result in the last ${Math.round(STALE_MINUTES / 60)} hours:</p>`
    + `<ul>${items}</ul>`
    + "<p>Every other check kept reporting in the same window, so the repository is busy and these publishers are not.</p>"
    + "<p>Restore the publisher, or ask Valentin to remove the check from the required list.</p>";
}

export const TICKET_DESCRIPTION =
  `<p><strong>What's wrong or wanted:</strong> A required check stopped publishing results, so every pull request waits for a verdict that never comes.</p>`
  + "<p><strong>Who it affects:</strong> every pull request and every agent waiting to merge</p>"
  + "<p><strong>Recommended course and why:</strong> restore the publisher named in the comment below, then dispatch the hourly Required Check Settings run. Why: a required check blocks merges until something publishes it.</p>"
  + "<p><strong>What Valentin must decide:</strong> nothing, unless the check should no longer be required</p>"
  + "<p><strong>How to undo:</strong> close this ticket once the checks report again</p>";

export function reportKey(silent, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}:${silent.slice().sort().join(",")}`).digest("hex").slice(0, 24);
}

function ghApi(endpoint) {
  try {
    return JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? "unknown").trim().slice(0, 200);
    throw new Error(`GitHub read ${endpoint.split("?")[0]} failed: ${detail}`);
  }
}

async function boardWrite(fetchImpl, token, path, body, key) {
  const response = await fetchImpl(`${APP}/api/mcp${path}`, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Board API returned HTTP ${response.status}`);
  const result = await response.json();
  if (result?.success === false) throw new Error("Board API rejected the write");
  return result;
}

async function reopen(fetchImpl, token, taskId, log) {
  const projects = await boardWrite(fetchImpl, token, "/projects?limit=100");
  const sections = (projects?.projects ?? []).find((item) => Number(item.id) === BOARD)?.sections;
  const active = sections?.find((item) => (item.section_title ?? item.title) === "Backlog")
    ?? sections?.find((item) => (item.section_title ?? item.title) !== "Done");
  if (!active?.id) throw new Error(`Board ${BOARD} active section is unavailable.`);
  await boardWrite(fetchImpl, token, "/tasks/update", { task_id: taskId, status: "Normal", sectionId: Number(active.id) });
  log(`Required-check publishers: reopened ticket ${taskId}.`);
}

async function report({ fetchImpl, token, silent, now, log }) {
  const key = `required-check-publishers-${reportKey(silent, now)}`;
  let existing;
  let found = null;
  for (const status of ["Normal", "Archive", "Deleted"]) {
    const page = await boardWrite(fetchImpl, token, `/tasks?project_id=${BOARD}&status=${status}&search=${encodeURIComponent(TICKET_TITLE)}&limit=100`);
    existing = (page?.tasks ?? []).find((task) => task.title === TICKET_TITLE);
    if (existing) {
      found = status;
      break;
    }
  }
  if (existing) {
    if (found !== "Normal") await reopen(fetchImpl, token, existing.id, log);
    await boardWrite(fetchImpl, token, "/comments", { task_id: existing.id, text: commentText(silent), content_type: "html" }, key);
    log(`Required-check publishers: commented on ticket ${existing.id}.`);
    return;
  }
  const created = await boardWrite(fetchImpl, token, "/tasks/create", { project_id: BOARD, title: TICKET_TITLE, description: TICKET_DESCRIPTION, content_type: "html" }, key);
  if (!created?.task?.id) throw new Error("Board created the reporting ticket without a task id.");
  await boardWrite(fetchImpl, token, "/comments", { task_id: created.task.id, text: commentText(silent), content_type: "html" }, key);
  log(`Required-check publishers: opened ticket ${created.task.id}.`);
}

export async function run({ gh = ghApi, fetchImpl = fetch, env = process.env, now = Date.now(), log = console.log } = {}) {
  const repo = env.REPO;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("Missing or invalid REPO.");
  const rulesets = gh(`repos/${repo}/rulesets?per_page=100`);
  const active = (Array.isArray(rulesets) ? rulesets : [])
    .filter((ruleset) => ruleset?.name === "production-required-checks" && ruleset.enforcement === "active");
  if (active.length !== 1) throw new Error("Expected one active production-required-checks ruleset.");
  const required = requiredContexts(gh(`repos/${repo}/rulesets/${active[0].id}`));
  if (!required.length) throw new Error("The live ruleset lists no required status checks.");

  const pulls = gh(`repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${PR_LIMIT}`);
  const since = now - LOOKBACK_HOURS * 3_600_000;
  const seen = [];
  for (const pull of Array.isArray(pulls) ? pulls : []) {
    if (!Number.isFinite(Date.parse(pull?.updated_at)) || Date.parse(pull.updated_at) < since) continue;
    if (!/^[0-9a-f]{40}$/.test(pull?.head?.sha ?? "")) continue;
    const runs = gh(`repos/${repo}/commits/${pull.head.sha}/check-runs?per_page=100&filter=all`);
    const statuses = gh(`repos/${repo}/commits/${pull.head.sha}/statuses?per_page=100`);
    seen.push(...observations(runs?.check_runs, statuses));
  }

  const verdict = silentRequiredChecks({ required, seen, now });
  if (!verdict.judged) {
    log(`Required-check publishers: no check result in the last ${STALE_MINUTES} minutes, so nothing is judged.`);
    return verdict;
  }
  if (!verdict.silent.length) {
    log(`Required-check publishers: all ${required.length} required checks reported in the last ${STALE_MINUTES} minutes.`);
    return verdict;
  }
  const token = env.HYPERTASK_MCP_TOKEN;
  if (!token) throw new Error("Missing HYPERTASK_MCP_TOKEN, so a silent required check cannot be reported.");
  await report({ fetchImpl, token, silent: verdict.silent, now, log });
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Required checks with no publisher\n\n${verdict.silent.map((context) => `- ${context}`).join("\n")}\n`);
  }
  log(`::warning::Required checks with no publisher in the last ${STALE_MINUTES} minutes: ${verdict.silent.join(", ")}`);
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : "Required-check publisher check failed"}`);
    process.exitCode = 1;
  });
}
