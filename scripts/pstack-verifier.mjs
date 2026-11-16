import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONTEXT, completeWithOpenRouter, cookiesFromHeader, performOnPage, readSmokeEnv, redact, statusPayload, verifyLoop,
} from "./pstack-verifier-protocol.mjs";
function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || "gh failed").split("\n")[0]);
  return result.stdout;
}
function output(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  writeFileSync(file, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { flag: "a" });
}
function requireRepo(repo) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("repository is not a name");
  return repo;
}
function resolveRequest() {
  const repo = requireRepo(process.env.REPO);
  const sha = process.env.REQUEST_HEAD_SHA ?? "";
  const work = process.env.WORK;
  mkdirSync(work, { recursive: true });
  if (process.env.REQUEST_CONCLUSION !== "success" || !/^[0-9a-f]{40}$/.test(sha)) return output({ skip: "true" });
  let pr = process.env.REQUEST_PR ?? "";
  if (!/^[0-9]+$/.test(pr)) {
    const pulls = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}/pulls`]));
    const matches = pulls.filter((item) => item.state === "open" && item.draft === false && item.base?.ref === "production" && item.head?.sha === sha && item.head?.repo?.full_name === repo);
    if (matches.length !== 1) return output({ skip: "true" });
    pr = String(matches[0].number);
  }
  const item = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}`]));
  if (item.state !== "open" || item.draft || item.base?.ref !== "production" || item.head?.sha !== sha || item.head?.repo?.full_name !== repo) {
    return output({ skip: "true" });
  }
  writeFileSync(path.join(work, "pr.json"), JSON.stringify({
    number: item.number,
    sha: item.head.sha,
    title: String(item.title ?? "").slice(0, 300),
    body: String(item.body ?? "").slice(0, 4000),
  }));
  writeFileSync(path.join(work, "pr.diff"), gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/pulls/${pr}`]).slice(0, 200000));
  gh(["api", "--method", "POST", `repos/${repo}/statuses/${sha}`, "-f", "state=pending", "-f", `context=${CONTEXT}`, "-f", "description=Driving the seeded app in a browser"]);
  output({ skip: "false", sha, pr: String(item.number), repository: repo });
}
async function drive() {
  const work = process.env.WORK;
  const ready = readSmokeEnv(readFileSync(process.env.PSTACK_READY, "utf8"));
  const seeded = readSmokeEnv(readFileSync(ready.env, "utf8"));
  const meta = JSON.parse(readFileSync(path.join(work, "pr.json"), "utf8"));
  const diff = readFileSync(path.join(work, "pr.diff"), "utf8");
  const shotsDir = path.join(work, "shots");
  mkdirSync(shotsDir, { recursive: true });
  const projectId = seeded.CORE_SMOKE_PROJECT_ID;
  const smoke = {
    cookie: seeded.CORE_SMOKE_COOKIE,
    key: process.env.OPENROUTER_EVAL_KEY || "",
    boardPath: `/project?id=${projectId}`,
    taskPath: `/detail/project-${projectId}/1`,
  };
  const verdictPath = path.join(work, "verdict.json");
  let result;
  const browserHolder = { browser: null };
  try {
    if (!smoke.key) throw new Error("model login is missing");
    const { chromium } = await import("playwright");
    browserHolder.browser = await chromium.launch({ headless: true });
    const context = await browserHolder.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookiesFromHeader(smoke.cookie, ready.url));
    const page = await context.newPage();
    await page.goto(new URL(smoke.boardPath, ready.url).toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
    let turn = 0;
    result = await verifyLoop({
      meta, diff, smoke,
      complete: (prompt) => completeWithOpenRouter(prompt, { key: smoke.key }),
      perform: (actions) => performOnPage(page, actions, shotsDir, ++turn, ready.url),
    });
  } catch (error) {
    result = { verdict: "FAIL", notes: String(error.message ?? error).split("\n")[0], clicked: [], shots: [] };
  } finally {
    await browserHolder.browser?.close();
  }
  writeFileSync(verdictPath, `${JSON.stringify({ ...result, notes: redact(result.notes, [smoke.cookie, smoke.key]) })}\n`, { mode: 0o600 });
}
async function post() {
  const repo = requireRepo(process.env.REPO);
  const sha = process.env.HEAD_SHA ?? "";
  const pr = process.env.PR ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[0-9]+$/.test(pr)) throw new Error("the pull request head is missing");
  const item = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}`]));
  if (item.state !== "open" || item.head?.sha !== sha) return;
  let saved;
  try { saved = JSON.parse(readFileSync(path.join(process.env.WORK, "verdict.json"), "utf8")); }
  catch { saved = { verdict: "FAIL", notes: "The verifier did not finish.", clicked: [] }; }
  const payload = statusPayload(saved);
  const response = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` }),
  });
  if (!response.ok) throw new Error(`status HTTP ${response.status}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${payload.description}\n`, { flag: "a" });
  if (payload.state === "failure") process.exitCode = 1;
}
async function main() {
  const command = process.argv[2];
  if (command === "resolve") resolveRequest();
  else if (command === "drive") await drive();
  else if (command === "post") await post();
  else throw new Error("usage: pstack-verifier.mjs resolve|drive|post");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(redact(error.message ?? String(error), [process.env.OPENROUTER_EVAL_KEY || ""]));
    process.exitCode = 1;
  });
}
