#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifyActionsLog, renderReport, sameAppCode } from "./flaky-log.mjs";

const WORKFLOW = "repos/hypertask-ai/hypertask/actions/workflows/345284758/runs";
const CACHE = process.env.FLAKY_CACHE || ".cache/flaky-tests";
const args = process.argv.slice(2);
const since = argValue("--since") || daysAgo(14);
const until = argValue("--until") || utcDay(new Date());
const outPath = argValue("--out");

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? "" : args[index + 1] || "";
}

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return utcDay(date);
}

function eachDay(start, end) {
  const days = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    days.push(utcDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function cachePath(name) {
  mkdirSync(CACHE, { recursive: true });
  return join(CACHE, name);
}

function readCache(name) {
  const path = cachePath(name);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function writeCache(name, text) {
  writeFileSync(cachePath(name), text);
}

function gh(argsList) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return execFileSync("gh", argsList, {
        encoding: "utf8",
        maxBuffer: 80 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      lastError = error;
      const detail = `${error.stderr || ""}${error.stdout || ""}${error.message || ""}`;
      if (/HTTP 404/.test(detail)) break;
      sleep(1000 * attempt);
    }
  }
  const detail = `${lastError?.stderr || ""}${lastError?.message || "gh failed"}`;
  throw new Error(detail.trim());
}

function fetchDay(day) {
    const name = `runs-v2-${day}.tsv`;
  const cached = readCache(name);
  if (cached !== null) return cached;
  const query = `${WORKFLOW}?created=${day}..${day}&per_page=100`;
  const text = gh(["api", "--paginate", query, "--jq", ".workflow_runs[] | [.id,.run_attempt,.conclusion,.head_sha,.html_url,.created_at,.event,.status,.head_branch] | @tsv"]);
  if (text.trim().split("\n").filter(Boolean).length >= 1000) {
    throw new Error(`day ${day} hit the 1000-run page cap; split the window`);
  }
  writeCache(name, text);
  return text;
}

function parseRuns(text) {
  const runs = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [id, attempt, conclusion, sha, url, createdAt, event, status, branch] = line.split("\t");
    if (!/^[0-9a-f]{40}$/.test(sha || "")) continue;
    runs.push({
      id: Number(id),
      attempt: Number(attempt),
      conclusion: conclusion || "",
      sha,
      url,
      createdAt,
      event,
      status,
      branch: branch || "",
    });
  }
  return runs;
}

function fetchJobs(runId, attempt) {
  const name = `jobs-${runId}-${attempt}.json`;
  const cached = readCache(name);
  if (cached !== null) return JSON.parse(cached);
  const payload = gh(["api", `repos/hypertask-ai/hypertask/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`]);
  writeCache(name, payload);
  return JSON.parse(payload);
}

function fetchFailedLog(runId, attempt, jobId) {
  const name = `log-${runId}-${attempt}.txt`;
  const cached = readCache(name);
  if (cached !== null && cached.length > 200) return cached;
  let text = "";
  if (jobId) {
    try {
      text = gh(["api", "--allow-escape-sequences", `repos/hypertask-ai/hypertask/actions/jobs/${jobId}/logs`]);
    } catch {
      text = "";
    }
  }
  if (!text || text.length < 200) {
    try {
      text = gh(["run", "view", String(runId), "--attempt", String(attempt), "--log-failed"]);
    } catch (error) {
      text = `LOG_UNAVAILABLE ${error.message}`;
    }
  }
  writeCache(name, text || "");
  return text || "";
}

function ciTestsJob(jobsPayload) {
  return (jobsPayload.jobs || []).find((job) => job.name === "ci-tests") || null;
}

function attemptUrl(run, attempt) {
  return `${run.url}/attempts/${attempt}`;
}

function changedFiles(shaA, shaB) {
  const name = `diff-${[shaA, shaB].sort().join("-")}.txt`;
  const cached = readCache(name);
  if (cached !== null) return cached.split("\n").filter(Boolean);
  let text = "";
  try {
    text = execFileSync("git", ["diff", "--name-only", shaA, shaB], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    const payload = gh(["api", `repos/hypertask-ai/hypertask/compare/${shaA}...${shaB}`, "--jq", "[.files[].filename] | join(\"\\n\")"]);
    text = payload;
  }
  writeCache(name, text.endsWith("\n") ? text : `${text}\n`);
  return text.split("\n").filter(Boolean);
}

function jobPair(run) {
  const attempts = [];
  for (let attempt = 1; attempt <= run.attempt; attempt += 1) {
    const job = ciTestsJob(fetchJobs(run.id, attempt));
    if (!job) continue;
    attempts.push({
      attempt,
      conclusion: job.conclusion || "",
      url: attemptUrl(run, attempt),
      id: job.id,
    });
  }
  const failures = attempts.filter((item) => item.conclusion === "failure");
  const passes = attempts.filter((item) => item.conclusion === "success");
  return { failures, passes };
}

function latestNamedJob(run, jobName) {
  const payload = fetchJobs(run.id, run.attempt || 1);
  const job = (payload.jobs || []).find((item) => item.name === jobName);
  if (!job || (job.conclusion !== "failure" && job.conclusion !== "success")) return null;
  return {
    conclusion: job.conclusion,
    url: job.html_url || attemptUrl(run, run.attempt || 1),
    id: job.id,
  };
}

function testsForJob(jobName, classified) {
  if (jobName === "browser-smoke") return classified.tests.filter((name) => name.startsWith("e2e/"));
  return classified.tests.filter((name) => !name.startsWith("e2e/"));
}

function collectSameCode(runs) {
  const byBranch = new Map();
  for (const run of runs) {
    if (run.event !== "pull_request" || !run.branch || run.branch === "production" || run.branch === "main") continue;
    if (run.status === "in_progress" || run.status === "queued") continue;
    const list = byBranch.get(run.branch) ?? [];
    list.push(run);
    byBranch.set(run.branch, list);
  }
  const incidents = [];
  const seen = new Set();
  for (const [branch, group] of byBranch) {
    const shas = new Set(group.map((run) => run.sha));
    if (shas.size < 2) continue;
    process.stderr.write(`same-code ${branch} (${shas.size} shas)\n`);
    for (const jobName of ["ci-tests", "browser-smoke"]) {
      const outcomes = [];
      for (const run of group) {
        try {
          const job = latestNamedJob(run, jobName);
          if (job) outcomes.push({ run, job });
        } catch (error) {
          process.stderr.write(`jobs ${run.id}: ${error.message}\n`);
        }
      }
      const passes = outcomes.filter((item) => item.job.conclusion === "success");
      const failures = outcomes.filter((item) => item.job.conclusion === "failure");
      for (const failure of failures) {
        const pass = passes.find((item) => item.run.sha !== failure.run.sha);
        if (!pass) continue;
        const key = `${jobName}:${failure.run.sha}:${failure.run.attempt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const log = fetchFailedLog(failure.run.id, failure.run.attempt || 1, failure.job.id);
        const classified = classifyActionsLog(log);
        const names = testsForJob(jobName, classified);
        if (names.length === 0) continue;
        let files = [];
        try {
          files = changedFiles(failure.run.sha, pass.run.sha);
        } catch (error) {
          process.stderr.write(`diff ${failure.run.sha.slice(0, 8)} ${pass.run.sha.slice(0, 8)}: ${error.message}\n`);
          continue;
        }
        if (!sameAppCode(files, names)) continue;
        for (const test of names) {
          incidents.push({
            test,
            sha: failure.run.sha,
            runId: failure.run.id,
            attempt: failure.run.attempt || 1,
            failUrl: failure.job.url,
            passUrl: pass.job.url,
            evidenceLine: classified.evidenceByTest?.get(test) || classified.evidenceLine,
          });
        }
      }
    }
  }
  return incidents;
}

function main() {
  const runs = [];
  for (const day of eachDay(since, until)) {
    process.stderr.write(`fetch ${day}\n`);
    runs.push(...parseRuns(fetchDay(day)));
  }
  const bySha = new Map();
  for (const run of runs) {
    const list = bySha.get(run.sha) ?? [];
    list.push(run);
    bySha.set(run.sha, list);
  }

  const interesting = [];
  for (const group of bySha.values()) {
    const retried = group.some((run) => run.attempt > 1);
    const conclusions = new Set(group.map((run) => run.conclusion));
    const mixedRuns = conclusions.has("failure") && conclusions.has("success");
    if (retried || mixedRuns) interesting.push(group);
  }

  const testIncidents = [];
  const nonTest = [];
  let failThenPass = 0;
  let flakyTestJobs = 0;
  const seenJobs = new Set();

  for (const group of interesting) {
    for (const run of group) {
      if (run.attempt < 1 || run.status === "in_progress" || run.status === "queued") continue;
      let pair;
      try {
        pair = jobPair(run);
      } catch (error) {
        process.stderr.write(`jobs ${run.id}: ${error.message}\n`);
        continue;
      }
      if (pair.failures.length === 0 || pair.passes.length === 0) {
        const otherPass = group.find((candidate) => candidate.id !== run.id && candidate.conclusion === "success");
        if (!otherPass || pair.failures.length === 0) continue;
        pair = { failures: pair.failures, passes: [{ attempt: otherPass.attempt, url: otherPass.url, conclusion: "success" }] };
      }
      failThenPass += 1;
      const passUrl = pair.passes[pair.passes.length - 1].url;
      let sawTest = false;
      for (const failure of pair.failures) {
        const key = `${run.id}:${failure.attempt}`;
        if (seenJobs.has(key)) continue;
        seenJobs.add(key);
        const log = fetchFailedLog(run.id, failure.attempt, failure.id);
        const classified = classifyActionsLog(log);
        if (classified.kind === "test") {
          sawTest = true;
          for (const test of classified.tests) {
            testIncidents.push({
              test,
              sha: run.sha,
              runId: run.id,
              attempt: failure.attempt,
              failUrl: failure.url,
              passUrl,
              evidenceLine: classified.evidenceByTest?.get(test) || classified.evidenceLine,
            });
          }
        } else {
          nonTest.push({
            kind: classified.kind,
            infraId: classified.infraId || classified.kind,
            sha: run.sha,
            runId: run.id,
            attempt: failure.attempt,
            failUrl: failure.url,
            passUrl,
            evidenceLine: classified.evidenceLine || "no classifying log line",
          });
        }
      }
      if (sawTest) flakyTestJobs += 1;
    }
  }

  const sameCode = collectSameCode(runs);
  const retriedRuns = runs.filter((run) => run.attempt > 1).length;
  const report = renderReport({
    since,
    until,
    runsScanned: runs.length,
    retriedRuns,
    failThenPass,
    flakyTestJobs,
    testIncidents,
    nonTest,
    sameCode,
  });
  if (outPath) writeFileSync(outPath, report);
  process.stdout.write(report);
}

main();
