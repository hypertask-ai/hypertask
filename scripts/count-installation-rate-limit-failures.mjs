import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const INSTALLATION = /API rate limit exceeded for installation/i;
const WAIT_CAP = /GitHub rate limit wait cap exceeded \((\d+)s total; (\d+)s already waited, (\d+)s requested\)/;
const SECONDARY = /secondary rate limit/i;
const USER_LIMIT = /API rate limit exceeded for user/i;
const SCRIPT_ECHO = /\u001b\[36;1m|\^\[\[36;1m/;
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/;

export function classifyLog(log) {
  const hits = [];
  for (const raw of String(log).split(/\n/)) {
    if (SCRIPT_ECHO.test(raw)) continue;
    const installation = INSTALLATION.test(raw);
    const wait = WAIT_CAP.exec(raw);
    const secondary = SECONDARY.test(raw);
    const user = USER_LIMIT.test(raw);
    if (!installation && !wait && !secondary && !user) continue;
    const stamp = STAMP.exec(raw)?.[1] ?? null;
    const requestedSeconds = wait ? Number(wait[3]) : null;
    const waitedSeconds = wait ? Number(wait[2]) : null;
    let kind = "other";
    if (installation) kind = "installation";
    else if (user) kind = "user";
    else if (wait && !(secondary && requestedSeconds != null && requestedSeconds <= 120)) kind = "installation";
    else if (secondary || wait) kind = "secondary";
    const resetAt = stamp && requestedSeconds != null
      ? new Date(Date.parse(stamp) + requestedSeconds * 1000).toISOString()
      : null;
    hits.push({
      kind,
      match: installation ? "api-message" : wait ? "wait-cap" : user ? "user-message" : "secondary-message",
      requestedSeconds,
      waitedSeconds,
      resetAt,
      stamp,
      line: raw.replace(STAMP, "").replace(/^\s+/, "").replace(/^##\[error\]/, "").trim().slice(0, 420),
    });
  }
  return hits;
}

export function attributeStep(steps, hits) {
  const failed = (steps ?? []).filter((step) => step.conclusion === "failure");
  const interesting = hits.filter((hit) => hit.kind === "installation" || hit.kind === "secondary" || hit.kind === "user");
  if (!interesting.length) return null;
  const installation = interesting.some((hit) => hit.kind === "installation");
  const kind = installation ? "installation" : interesting[0].kind;
  const chosen = interesting.find((hit) => hit.kind === kind) ?? interesting[0];
  return {
    kind,
    step: failed.length === 1 ? failed[0].name : failed[0]?.name ?? "(no failed step recorded)",
    stepAttribution: failed.length === 1 ? "only-failed-step" : failed.length === 0 ? "job-log-only" : "first-failed-step",
    failedSteps: failed.map((step) => step.name),
    hit: chosen,
  };
}

export function utcDay(iso) {
  return String(iso).slice(0, 10);
}

export function windowSlices(start, end) {
  const slices = [];
  let day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  for (; day <= last; day += 86_400_000) {
    const from = new Date(Math.max(day, start.getTime()));
    const to = new Date(Math.min(day + 86_400_000, end.getTime()));
    if (from < to) slices.push({ day: new Date(day).toISOString().slice(0, 10), from, to });
  }
  return slices;
}

export function summarize(hits, { start, end, scannedRuns, unscannedJobs }) {
  const installation = hits.filter((hit) => hit.kind === "installation");
  const runs = new Map();
  for (const hit of installation) {
    const key = String(hit.runId);
    if (!runs.has(key)) runs.set(key, { ...hit, steps: new Set() });
    runs.get(key).steps.add(`${hit.workflow} / ${hit.step}`);
  }
  const byDay = new Map(windowSlices(start, end).map((slice) => [slice.day, 0]));
  const byStep = new Map();
  for (const run of runs.values()) {
    const day = utcDay(run.createdAt);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    for (const step of run.steps) byStep.set(`${day}\t${step}`, (byStep.get(`${day}\t${step}`) ?? 0) + 1);
  }
  const stepTotals = new Map();
  for (const [key, count] of byStep) {
    const step = key.split("\t").slice(1).join("\t");
    stepTotals.set(step, (stepTotals.get(step) ?? 0) + count);
  }
  const resets = installation
    .filter((hit) => hit.resetAt)
    .map((hit) => hit.resetAt)
    .sort();
  return {
    window: { start: start.toISOString(), end: end.toISOString() },
    scannedRuns,
    unscannedJobs,
    installationRuns: runs.size,
    otherKinds: {
      secondary: new Set(hits.filter((hit) => hit.kind === "secondary").map((hit) => hit.runId)).size,
      user: new Set(hits.filter((hit) => hit.kind === "user").map((hit) => hit.runId)).size,
    },
    byDay: [...byDay.entries()].sort(),
    byDayStep: [...byStep.entries()].sort(),
    stepTotals: [...stepTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    resets,
  };
}

function tokenFromEnv() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

function parseArgs(argv) {
  const options = { repo: "hypertask-ai/hypertask", days: 14, cache: "", out: "", concurrency: 6 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo") options.repo = argv[++i];
    else if (arg === "--days") options.days = Number(argv[++i]);
    else if (arg === "--cache") options.cache = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--concurrency") options.concurrency = Number(argv[++i]);
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repo)) throw new Error("Invalid --repo");
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 30) throw new Error("Invalid --days");
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 8) throw new Error("Invalid --concurrency");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = tokenFromEnv();
  const end = new Date();
  const start = new Date(end.getTime() - options.days * 86_400_000);
  const state = { apiCalls: 0, remaining: null, limit: null, reset: null };
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "yper4-678-installation-rate-limit-count",
  };

  async function request(url, attempt = 0) {
    const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(90_000) });
    state.apiCalls++;
    const remaining = response.headers.get("x-ratelimit-remaining");
    const limit = response.headers.get("x-ratelimit-limit");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining != null) state.remaining = Number(remaining);
    if (limit != null) state.limit = Number(limit);
    if (reset != null) state.reset = Number(reset);
    if (response.status === 403 || response.status === 429) {
      const body = await response.text();
      if (/rate limit/i.test(body) || remaining === "0") {
        const waitMs = reset ? Math.max(1000, Number(reset) * 1000 - Date.now() + 1500) : 60_000;
        if (attempt >= 2 || waitMs > 15 * 60_000) throw new Error(`Measurement token rate limited (HTTP ${response.status})`);
        console.error(`measurement token rate limited; waiting ${Math.ceil(waitMs / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return request(url, attempt + 1);
      }
      throw new Error(`GitHub HTTP ${response.status} for ${url}`);
    }
    if (response.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      return request(url, attempt + 1);
    }
    return response;
  }

  async function json(url) {
    const response = await request(url);
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status} for ${url}`);
    return response.json();
  }

  async function mapPool(items, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await fn(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(options.concurrency, items.length) }, () => worker()));
    return out;
  }

  async function listFailed(from, to, status) {
    const created = `${from.toISOString().replace(/\.\d{3}Z$/, "Z")}..${to.toISOString().replace(/\.\d{3}Z$/, "Z")}`;
    const base = `https://api.github.com/repos/${options.repo}/actions/runs?status=${status}&per_page=100&created=${encodeURIComponent(created)}`;
    const first = await json(base + "&page=1");
    if (first.total_count >= 1000) {
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      if (to - from < 15 * 60_000) throw new Error(`Failure page still capped between ${from.toISOString()} and ${to.toISOString()}`);
      return [...await listFailed(from, mid, status), ...await listFailed(mid, to, status)];
    }
    const runs = [...first.workflow_runs];
    for (let page = 2; runs.length < first.total_count; page++) {
      const next = await json(base + `&page=${page}`);
      if (!next.workflow_runs.length) break;
      runs.push(...next.workflow_runs);
    }
    if (runs.length !== first.total_count) {
      throw new Error(`Listed ${runs.length} failed runs but total_count is ${first.total_count} for ${created}`);
    }
    return runs;
  }

  const cacheFile = options.cache ? `${options.cache}/runs.json` : "";
  let runs;
  if (cacheFile) {
    try {
      runs = JSON.parse(readFileSync(cacheFile, "utf8"));
      console.error(`loaded ${runs.length} cached failed runs`);
    } catch {
      runs = null;
    }
  }
  if (!runs) {
    const pieces = [];
    for (const status of ["failure", "startup_failure", "timed_out"]) {
      for (const slice of windowSlices(start, end)) pieces.push(await listFailed(slice.from, slice.to, status));
    }
    const byId = new Map();
    for (const run of pieces.flat()) byId.set(run.id, run);
    runs = [...byId.values()];
    if (options.cache) {
      mkdirSync(options.cache, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(runs.map((run) => ({
        id: run.id, name: run.name, html_url: run.html_url, event: run.event, created_at: run.created_at, conclusion: run.conclusion,
      }))));
    }
  }
  console.error(`failed runs in window: ${runs.length}`);

  const hits = [];
  let unscannedJobs = 0;
  let scannedJobs = 0;
  await mapPool(runs, async (run, index) => {
    const jobsUrl = `https://api.github.com/repos/${options.repo}/actions/runs/${run.id}/jobs?per_page=100`;
    let jobs;
    try {
      const body = await json(jobsUrl);
      jobs = body.jobs ?? [];
      if (body.total_count > jobs.length) {
        for (let page = 2; jobs.length < body.total_count; page++) {
          const next = await json(`${jobsUrl}&page=${page}`);
          jobs.push(...(next.jobs ?? []));
        }
      }
    } catch (error) {
      unscannedJobs++;
      console.error(`jobs failed for run ${run.id}: ${error.message}`);
      return;
    }
    const failedJobs = jobs.filter((job) => job.conclusion === "failure");
    for (const job of failedJobs) {
      let text = "";
      try {
        const response = await request(`https://api.github.com/repos/${options.repo}/actions/jobs/${job.id}/logs`);
        if (response.status === 410) {
          unscannedJobs++;
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        text = bytes[0] === 0x50 && bytes[1] === 0x4b ? unzipText(bytes) : bytes.toString("utf8");
      } catch (error) {
        unscannedJobs++;
        console.error(`log failed for job ${job.id}: ${error.message}`);
        continue;
      }
      scannedJobs++;
      const found = classifyLog(text);
      const attributed = attributeStep(job.steps, found);
      if (!attributed) continue;
      hits.push({
        kind: attributed.kind,
        match: attributed.hit.match,
        runId: run.id,
        url: run.html_url,
        workflow: run.name,
        event: run.event,
        createdAt: run.created_at,
        job: job.name,
        step: attributed.step,
        stepAttribution: attributed.stepAttribution,
        failedSteps: attributed.failedSteps,
        requestedSeconds: attributed.hit.requestedSeconds,
        waitedSeconds: attributed.hit.waitedSeconds,
        resetAt: attributed.hit.resetAt,
        line: attributed.hit.line,
      });
    }
    if ((index + 1) % 25 === 0) console.error(`scanned ${index + 1}/${runs.length} runs, installation hits ${hits.filter((hit) => hit.kind === "installation").length}`);
  });

  const summary = summarize(hits, { start, end, scannedRuns: runs.length, unscannedJobs });
  const examples = [];
  const seen = new Set();
  for (const hit of hits.filter((item) => item.kind === "installation")) {
    const key = `${hit.workflow}\t${hit.step}`;
    if (seen.has(key) || examples.filter((item) => item.workflow === hit.workflow && item.step === hit.step).length >= 2) continue;
    seen.add(key);
    examples.push({ workflow: hit.workflow, step: hit.step, url: hit.url, match: hit.match, line: hit.line, createdAt: hit.createdAt, resetAt: hit.resetAt, requestedSeconds: hit.requestedSeconds });
  }
  const report = {
    ...summary,
    scannedJobs,
    examples,
    measurement: { apiCalls: state.apiCalls, limit: state.limit, remaining: state.remaining, reset: state.reset ? new Date(state.reset * 1000).toISOString() : null },
    ambiguousSteps: hits.filter((hit) => hit.kind === "installation" && hit.stepAttribution !== "only-failed-step").length,
  };
  const text = render(report);
  console.log(text);
  if (options.out) writeFileSync(options.out, JSON.stringify(report, null, 2));
  if (report.unscannedJobs > 0) process.exitCode = 2;
}

function unzipText(bytes) {
  const dir = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  try {
    writeFileSync(`${dir}/log.zip`, bytes);
    execFileSync("unzip", ["-qq", "-d", `${dir}/out`, `${dir}/log.zip`]);
    return execFileSync("bash", ["-lc", `find ${JSON.stringify(`${dir}/out`)} -type f -print0 | xargs -0 cat`], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function render(report) {
  const lines = [];
  lines.push(`window ${report.window.start} .. ${report.window.end}`);
  lines.push(`failed runs scanned ${report.scannedRuns}; jobs scanned ${report.scannedJobs}; jobs unscanned ${report.unscannedJobs}`);
  lines.push(`installation-rate-limit runs ${report.installationRuns}`);
  lines.push(`excluded secondary runs ${report.otherKinds.secondary}; user-token runs ${report.otherKinds.user}`);
  lines.push(`ambiguous step attribution ${report.ambiguousSteps}`);
  lines.push("");
  lines.push("day\truns");
  for (const [day, count] of report.byDay) lines.push(`${day}\t${count}`);
  lines.push("");
  lines.push("day\tworkflow / step\truns");
  for (const [key, count] of report.byDayStep) {
    const [day, step] = key.split("\t");
    lines.push(`${day}\t${step}\t${count}`);
  }
  lines.push("");
  lines.push("workflow / step\truns");
  for (const [step, count] of report.stepTotals) lines.push(`${step}\t${count}`);
  lines.push("");
  lines.push("examples");
  for (const example of report.examples) {
    lines.push(`${example.createdAt} ${example.workflow} / ${example.step} ${example.match} ${example.url}`);
    lines.push(`  ${example.line}`);
    if (example.resetAt) lines.push(`  reset ${example.resetAt} (requested ${example.requestedSeconds}s)`);
  }
  lines.push("");
  lines.push(`measurement api calls ${report.measurement.apiCalls}; token limit ${report.measurement.limit}; remaining ${report.measurement.remaining}; reset ${report.measurement.reset}`);
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
