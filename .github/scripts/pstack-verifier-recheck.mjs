import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const VERIFIER_WORKFLOW = ".github/workflows/pstack-verifier.yml";
export const SOURCE_WORKFLOWS = ["CI Tests", "PR Guards"];
export const RERUN_LIMIT = 10;
export const WAITING = "waiting for required checks";

export function sourceStartsRecheck(name) {
  return SOURCE_WORKFLOWS.includes(name);
}

export function runIsVerifier(run) {
  return run?.path === VERIFIER_WORKFLOW || run?.name === "pstack-verifier";
}

export function exactWaiting(status) {
  return !!status && status.context === "pstack-verifier" && status.state === "pending" && status.description === WAITING;
}

export function exactFailed(status) {
  return !!status && status.context === "pstack-verifier" && status.state === "failure";
}

export function shouldRerun(status, run, recovered = false) {
  return runIsVerifier(run) && (exactWaiting(status) || (recovered && exactFailed(status)));
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

export function rerunRequest(repo, sha, call, recovered = false) {
  const statuses = JSON.parse(call(["api", `repos/${repo}/commits/${sha}/statuses`]));
  const status = newestVerifierStatus(statuses);
  if (!exactWaiting(status) && !(recovered && exactFailed(status))) {
    console.log(`skip ${sha}: the verifier status is neither waiting nor failed`);
    return false;
  }
  const runId = runIdFromUrl(status.target_url);
  const run = runId ? JSON.parse(call(["api", `repos/${repo}/actions/runs/${runId}`])) : null;
  if (!shouldRerun(status, run, recovered)) {
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
    if (!exactWaiting(status)) continue;
    const runId = runIdFromUrl(status.target_url);
    const run = runId ? JSON.parse(call(["api", `repos/${repo}/actions/runs/${runId}`])) : null;
    if (!shouldRerun(status, run)) {
      console.log(`skip ${sha}: foreign target_url`);
      continue;
    }
    waiting.push({ number: item.number, sha, waitingSince: status.created_at });
  }
  for (const item of selectReruns(waiting)) rerunRequest(repo, item.sha, call);
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
    rerunRequest(repo, sha, gh, event.workflow_run.conclusion === "success");
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
