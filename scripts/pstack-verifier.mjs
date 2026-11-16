import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const run = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).workflow_run ?? {};
  const repo = requireRepo(process.env.GITHUB_REPOSITORY);
  const sha = String(run.head_sha ?? "");
  const work = process.env.WORK;
  mkdirSync(work, { recursive: true });
  if (run.conclusion !== "success" || !/^[0-9a-f]{40}$/.test(sha)) return output({ skip: "true" });
  let pr = String(run.pull_requests?.[0]?.number ?? "");
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
  gh(["api", "--method", "POST", `repos/${repo}/statuses/${sha}`, "-f", "state=pending", "-f", `context=${CONTEXT}`, "-f", "description=Driving the seeded app in a browser"]);
  output({ skip: "false", rev: sha, pr: String(item.number), repository: repo });
}
function loadPull() {
  const repo = requireRepo(process.env.REPO || process.env.GITHUB_REPOSITORY), work = process.env.WORK, item = JSON.parse(gh(["api", `repos/${repo}/pulls/${process.env.PR}`]));
  if (item.head?.sha !== process.env.HEAD_SHA) throw new Error("the pull request head moved");
  writeFileSync(path.join(work, "pr.json"), JSON.stringify({ number: item.number, sha: item.head.sha, title: String(item.title ?? "").slice(0, 300), body: String(item.body ?? "").slice(0, 4000) }));
  writeFileSync(path.join(work, "pr.diff"), gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/pulls/${item.number}`]).slice(0, 200000));
}
const unfinished = () => ({ verdict: "FAIL", notes: "The verifier did not finish.", clicked: [] });
function readVerdict(text) {
  if (typeof text !== "string" || text.length > 4000) return unfinished();
  try { const body = JSON.parse(text); return { verdict: ["PASS", "PASS+NOTES", "FAIL"].includes(body?.verdict) ? body.verdict : "FAIL", clicked: Array.isArray(body?.clicked) ? body.clicked.filter((item) => typeof item === "string" && item.length <= 80).slice(0, 8) : [], notes: String(body?.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 500) }; } catch { return unfinished(); }
}
function readObs(text) { if (text.length > 24000) throw new Error("observation is too long"); const body = JSON.parse(text); if (!Number.isInteger(body?.turn) || body.turn < 1 || body.turn > 4 || typeof body.prompt !== "string" || body.prompt.length < 1 || body.prompt.length > 20000) throw new Error("observation is not allowed"); return { turn: body.turn, prompt: body.prompt }; }
let relayClient; const artifactClient = async () => relayClient ??= (await import("@actions/artifact")).default;
const relayOwner = () => { const [repositoryOwner, repositoryName] = requireRepo(process.env.GITHUB_REPOSITORY).split("/"); const workflowRunId = Number(process.env.GITHUB_RUN_ID); const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN; if (!token || !workflowRunId) throw new Error("relay login is missing"); return { token, workflowRunId, repositoryOwner, repositoryName }; };
async function putBox(name, text) { if (typeof text !== "string" || text.length > 24000) throw new Error("relay text is too long"); const dir = path.join(process.env.WORK, "out"); mkdirSync(dir, { recursive: true }); const file = path.join(dir, `${name}.txt`); writeFileSync(file, text); await (await artifactClient()).uploadArtifact(name, [file], dir, { retentionDays: 1 }); }
async function readBox(client, item) { const dir = path.join(process.env.WORK, "in", String(item.id)); mkdirSync(dir, { recursive: true }); await client.downloadArtifact(item.id, { path: dir, findBy: relayOwner() }); const name = readdirSync(dir).find((entry) => entry.endsWith(".txt")); const text = name ? readFileSync(path.join(dir, name), "utf8") : ""; if (!name || text.length > 24000) throw new Error("relay text is too long"); return text; }
async function waitBox(name, doneName, ms) { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const client = await artifactClient(); const { artifacts } = await client.listArtifacts({ findBy: relayOwner() }); if (doneName && artifacts.some((item) => item.name === doneName)) return null; const item = artifacts.find((entry) => entry.name === name); if (item) return readBox(client, item); await new Promise((resolveWait) => setTimeout(resolveWait, 5000)); } return null; }
let relayTurn = 0;
async function relayComplete(prompt) { const body = JSON.stringify({ turn: relayTurn += 1, prompt: String(prompt) }); const id = process.env.GITHUB_RUN_ID; if (relayTurn > 4 || body.length > 24000) throw new Error("observation is not allowed"); await putBox(`pstack-obs-${id}-${relayTurn}`, body); const answerText = await waitBox(`pstack-act-${id}-${relayTurn}`, "", 180000); if (!answerText) throw new Error("the model did not answer"); return answerText; }
async function answer() { const key = process.env.OPENROUTER_EVAL_KEY || ""; const id = process.env.GITHUB_RUN_ID; if (!key) throw new Error("model login is missing"); for (let turn = 1; turn <= 4; turn += 1) { const raw = await waitBox(`pstack-obs-${id}-${turn}`, `pstack-done-${id}`, 1500000); if (raw === null) return; let content = JSON.stringify({ actions: [], verdict: "FAIL", notes: "observation is not allowed" }); try { const obs = readObs(raw); if (obs.turn !== turn) throw new Error("turn does not match"); content = redact(await completeWithOpenRouter(obs.prompt, { key }), [key]); } catch (error) { content = JSON.stringify({ actions: [], verdict: "FAIL", notes: redact(String(error.message ?? error), [key]).slice(0, 180) }); } await putBox(`pstack-act-${id}-${turn}`, content.slice(0, 8000)); } }
async function done() { await putBox(`pstack-done-${process.env.GITHUB_RUN_ID}`, "done"); }
async function drive() {
  const relayOn = process.env.PSTACK_RELAY === "1";
  if (relayOn) loadPull();
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
    if (!relayOn && !smoke.key) throw new Error("model login is missing");
    const { chromium } = await import("playwright");
    browserHolder.browser = await chromium.launch({ headless: true });
    const context = await browserHolder.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookiesFromHeader(smoke.cookie, ready.url));
    const page = await context.newPage();
    await page.goto(new URL(smoke.boardPath, ready.url).toString(), { waitUntil: "domcontentloaded", timeout: 20000 });
    let turn = 0;
    result = await verifyLoop({
      meta, diff, smoke,
      complete: (prompt) => relayOn ? relayComplete(prompt) : completeWithOpenRouter(prompt, { key: smoke.key }),
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
  const repo = requireRepo(process.env.REPO || process.env.GITHUB_REPOSITORY), sha = process.env.HEAD_SHA ?? "", pr = process.env.PR ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha) || !/^[0-9]+$/.test(pr)) throw new Error("the pull request head is missing");
  const item = JSON.parse(gh(["api", `repos/${repo}/pulls/${pr}`]));
  if (item.state !== "open" || item.head?.sha !== sha) return;
  let saved; try { saved = readVerdict(readFileSync(path.join(process.env.WORK, "verdict.json"), "utf8")); } catch { saved = readVerdict(""); }
  const payload = statusPayload(saved);
  const response = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, { method: "POST", headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, target_url: `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` }) });
  if (!response.ok) throw new Error(`status HTTP ${response.status}`);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${payload.description}\n`, { flag: "a" });
  if (payload.state === "failure") process.exitCode = 2;
}
async function main() {
  process.env.WORK ||= path.join(process.env.RUNNER_TEMP || "/tmp", "pstack-verifier");
  const command = process.argv[2];
  if (command === "resolve") resolveRequest();
  else if (command === "drive") await drive();
  else if (command === "answer") await answer();
  else if (command === "done") await done();
  else if (command === "post") await post();
  else throw new Error("usage: pstack-verifier.mjs resolve|drive|answer|done|post");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(redact(error.message ?? String(error), [process.env.OPENROUTER_EVAL_KEY || ""]));
    process.exitCode = 1;
  });
}
