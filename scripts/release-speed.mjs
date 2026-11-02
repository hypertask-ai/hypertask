#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = "hypertask-ai/hypertask";
export const GOAL_SECONDS = 600;

export function rowsFromRuns(runs) {
  const bySha = new Map();
  for (const run of runs) {
    const sha = run.head_sha;
    if (!run.started || !run.finished) continue;
    const started = Date.parse(run.started);
    const finished = Date.parse(run.finished);
    if (Number.isNaN(started) || Number.isNaN(finished)) continue;
    const row = bySha.get(sha) || { sha, started: Infinity, finished: 0, tail: "" };
    if (started < row.started) row.started = started;
    if (finished > row.finished) {
      row.finished = finished;
      row.tail = run.name || "";
    }
    bySha.set(sha, row);
  }
  return [...bySha.values()]
    .map((row) => ({ ...row, seconds: Math.round((row.finished - row.started) / 1000) }))
    .sort((a, b) => b.started - a.started);
}

export function summarise(rows, goal = GOAL_SECONDS) {
  const seconds = rows.map((row) => row.seconds).sort((a, b) => a - b);
  if (seconds.length === 0) return { pushes: 0, inside: 0, slowest: 0, median: 0, goal };
  const middle = Math.floor(seconds.length / 2);
  const median = seconds.length % 2 ? seconds[middle] : Math.round((seconds[middle - 1] + seconds[middle]) / 2);
  return {
    pushes: seconds.length,
    inside: seconds.filter((value) => value <= goal).length,
    slowest: seconds[seconds.length - 1],
    median,
    goal,
  };
}

export function formatTable(rows) {
  const lines = ["push (UTC)          sha       total  tail"];
  for (const row of rows) {
    const total = `${Math.floor(row.seconds / 60)}m ${String(row.seconds % 60).padStart(2, "0")}s`;
    lines.push(
      `${new Date(row.started).toISOString().slice(0, 16).replace("T", " ")}  ${row.sha.slice(0, 9)}  ${total.padStart(6)}  ${row.tail}`,
    );
  }
  return lines.join("\n");
}

export function formatSummary(summary) {
  const share = summary.pushes === 0 ? 0 : Math.round((summary.inside / summary.pushes) * 100);
  return `${summary.inside} of ${summary.pushes} production pushes finished inside ten minutes (${share}%), median ${summary.median}s, slowest ${summary.slowest}s`;
}

function fetchPushRuns(limit) {
  const runs = [];
  for (let page = 1; runs.length < limit * 8 && page <= 4; page += 1) {
    const body = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          `repos/${REPO}/actions/runs?event=push&branch=production&per_page=100&page=${page}`,
        ],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      ),
    );
    const batch = body.workflow_runs || [];
    for (const run of batch) {
      runs.push({
        name: run.name,
        head_sha: run.head_sha,
        started: run.run_started_at || run.created_at,
        finished: run.updated_at,
      });
    }
    if (batch.length < 100) break;
  }
  return runs;
}

function parseArgs(argv) {
  const options = { limit: 20, goal: GOAL_SECONDS };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit") options.limit = Number(argv[i += 1]);
    else if (argv[i] === "--goal") options.goal = Number(argv[i += 1]);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  const all = rowsFromRuns(fetchPushRuns(options.limit));
  const rows = all.slice(0, options.limit);
  const summary = summarise(rows, options.goal);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatTable(rows)}\n\n${formatSummary(summary)}\n`);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
