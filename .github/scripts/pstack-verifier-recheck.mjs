import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const compare = createRequire(import.meta.url)("../../scripts/lib/pstack-compare.cjs");
const VERIFIER_LOGINS = ["github-actions[bot]", "hypertask-runners[bot]"];
export const VERIFIER_WORKFLOW = ".github/workflows/pstack-verifier.yml";
export const SOURCE_WORKFLOWS = ["CI Tests", "PR Guards"];
export const RERUN_LIMIT = 10;
const WAITING_DESCRIPTION = "waiting for required checks";
export const WAITING = WAITING_DESCRIPTION;
export const UNEVALUATED_PREFIX = "verifier could not evaluate:";
export const UNEVALUATED_LIMIT = 3;

export function sourceStartsRecheck(name) {
  return SOURCE_WORKFLOWS.includes(name);
}

export function runIsVerifier(run) {
  return run?.path === VERIFIER_WORKFLOW || run?.name === "pstack-verifier";
}

export function exactWaiting(status) {
  return !!status && status.context === "pstack-verifier" && status.state === "pending" && status.description === WAITING_DESCRIPTION;
}

export function unevaluated(status) {
  return !!status && status.context === "pstack-verifier" && (status.state === "error" || status.state === "pending") && String(status.description ?? "").startsWith(UNEVALUATED_PREFIX);
}

export function evaluationAttempts(statuses) {
  return (Array.isArray(statuses) ? statuses : []).filter(unevaluated).length;
}

export function retryable(status, statuses) {
  if (exactWaiting(status)) return true;
  return unevaluated(status) && evaluationAttempts(statuses) < UNEVALUATED_LIMIT;
}

export function shouldRerun(status, run, statuses) {
  return retryable(status, statuses) && runIsVerifier(run);
}

export function workflowRunSha(event) {
  const run = event?.workflow_run;
  if (!run || run.event !== "pull_request" || !sourceStartsRecheck(run.name)) return "";
  const sha = String(run.head_sha ?? "");
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

export function newestVerifierStatus(statuses) {
  return (Array.isArray(statuses) ? statuses : []).find((status) => status?.context === "pstack-verifier") ?? null;
}

export function selectReruns(items, limit = RERUN_LIMIT) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item?.waitingSince)
    .sort((left, right) => Date.parse(left.waitingSince) - Date.parse(right.waitingSince) || String(left.number).localeCompare(String(right.number)))
    .slice(0, limit);
}

export function driftOf({ item, comments, logins = VERIFIER_LOGINS } = {}) {
  const marker = compare.summaryMarkers({ comments, logins }).at(-1);
  if (!marker) return null;
  const base = String(item?.base?.sha ?? "");
  if (!/^[0-9a-f]{40}$/.test(base) || marker.base === base) return null;
  return { number: item.number, sha: String(item?.head?.sha ?? ""), verifiedBase: marker.base, base };
}
export function selectDrift(items, limit = RERUN_LIMIT) {
  return [...(Array.isArray(items) ? items : [])].filter((item) => item?.verifiedBase).slice(0, limit);
}
export async function listProductionPulls(readPage) {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const chunk = await readPage(page);
    const rows = Array.isArray(chunk) ? chunk : [];
    pulls.push(...rows);
    if (rows.length < 100) {
      return pulls.filter((item) => item?.state === "open" && item.draft !== true && item.base?.ref === "production");
    }
  }
}

export function dispatchOnProduction(eventName, ref) {
  if (eventName !== "workflow_dispatch") return true;
  return ref === "refs/heads/production";
}

function gh(args, env = process.env) {
  const result = spawnSync("gh", args, { encoding: "utf8", env });
  if (result.status !== 0) throw new Error((result.stderr || "gh failed").split("\n")[0]);
  return result.stdout;
}

function runIdFromUrl(url) {
  const match = /\/actions\/runs\/(\d+)/.exec(String(url ?? ""));
  return match ? match[1] : "";
}

export function rerunRequest(repo, sha, call) {
  const statuses = JSON.parse(call(["api", `repos/${repo}/commits/${sha}/statuses`]));
  const status = newestVerifierStatus(statuses);
  if (!retryable(status, statuses)) {
    console.log(`skip ${sha}: ${unevaluated(status) ? "evaluation retries exhausted" : "description is not waiting for required checks"}`);
    return false;
  }
  const runId = runIdFromUrl(status.target_url);
  const run = runId ? JSON.parse(call(["api", `repos/${repo}/actions/runs/${runId}`])) : null;
  if (!shouldRerun(status, run, statuses)) {
    console.log(`skip ${sha}: foreign target_url`);
    return false;
  }
  const listed = JSON.parse(call(["api", `repos/${repo}/actions/workflows/pstack-verifier-request.yml/runs?head_sha=${sha}&status=success&per_page=1`]));
  const request = listed.workflow_runs?.[0];
  if (!request?.id) {
    console.log(`skip ${sha}: no successful request run`);
    return false;
  }
  call(["api", "--method", "POST", `repos/${repo}/actions/runs/${request.id}/rerun`]);
  console.log(`rerun ${request.id} for ${sha}`);
  return true;
}

async function sweep(repo, call) {
  const pulls = await listProductionPulls(async (page) => JSON.parse(call(["api", `repos/${repo}/pulls?state=open&base=production&per_page=100&page=${page}`])));
  const waiting = [];
  for (const item of pulls) {
    const sha = item?.head?.sha;
    if (!/^[0-9a-f]{40}$/.test(String(sha ?? ""))) continue;
    const statuses = JSON.parse(call(["api", `repos/${repo}/commits/${sha}/statuses`]));
    const status = newestVerifierStatus(statuses);
    if (!retryable(status, statuses)) continue;
    const runId = runIdFromUrl(status.target_url);
    const run = runId ? JSON.parse(call(["api", `repos/${repo}/actions/runs/${runId}`])) : null;
    if (!shouldRerun(status, run, statuses)) {
      console.log(`skip ${sha}: foreign target_url`);
      continue;
    }
    waiting.push({ number: item.number, sha, waitingSince: status.created_at });
  }
  for (const item of selectReruns(waiting)) rerunRequest(repo, item.sha, call);
  const drifted = [];
  for (const item of pulls) {
    const sha = item?.head?.sha;
    if (!/^[0-9a-f]{40}$/.test(String(sha ?? ""))) continue;
    const status = newestVerifierStatus(JSON.parse(call(["api", `repos/${repo}/commits/${sha}/statuses`])));
    if (!status || status.state !== "success") continue;
    const comments = JSON.parse(call(["api", "--paginate", `repos/${repo}/issues/${item.number}/comments?per_page=100`]));
    const drift = driftOf({ item, comments });
    if (drift) drifted.push({ ...drift, run: runIdFromUrl(status.target_url) });
  }
  for (const item of selectDrift(drifted)) {
    if (!item.run) continue;
    call(["api", "--method", "POST", `repos/${repo}/actions/runs/${item.run}/rerun`]);
    console.log(`rerun ${item.run} for ${item.sha}: verified against ${item.verifiedBase}, base is ${item.base}`);
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (!dispatchOnProduction(eventName, process.env.GITHUB_REF)) {
    console.log("skip: workflow_dispatch is not production");
    return;
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  if (eventName === "workflow_run") {
    const sha = workflowRunSha(event);
    if (!sha) {
      console.log("skip: workflow_run does not carry a candidate sha");
      return;
    }
    rerunRequest(repo, sha, gh);
    return;
  }
  if (eventName === "schedule" || eventName === "workflow_dispatch") {
    await sweep(repo, gh);
    return;
  }
  console.log(`skip: ${eventName || "missing event"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message ?? String(error));
    process.exitCode = 1;
  });
}
