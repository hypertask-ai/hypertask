import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { attachGuard, cookiesFromHeader, previewDownBody, readPlan, readSmokeEnv, recordNav, runPlan, waitForPreview } from "./pstack-verifier.mjs";

const work = process.env.WORK;
const binding = { sha: process.env.HEAD_SHA, run: String(process.env.GITHUB_RUN_ID), attempt: String(process.env.GITHUB_RUN_ATTEMPT) };
const evidenceDir = path.join(work, "evidence");
function writeEvidence(body) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, "evidence.json"), `${JSON.stringify(body)}\n`, { mode: 0o600 });
}
if (process.argv[2] === "--preview-down") {
  writeEvidence(previewDownBody(binding));
  process.exit(1);
}
const ready = readSmokeEnv(readFileSync(process.env.PSTACK_READY, "utf8"));
const seeded = readSmokeEnv(readFileSync(ready.env, "utf8"));
if (!(await waitForPreview(ready.url))) {
  writeEvidence(previewDownBody(binding));
  process.exit(1);
}
const plan = readPlan(readFileSync(path.join(work, "plan", "plan.json"), "utf8"), binding);
const shotsDir = path.join(evidenceDir, "shots");
mkdirSync(shotsDir, { recursive: true });
const offOrigin = [], navigations = [];
const browser = await chromium.launch({ headless: true });
const origin = new URL(ready.url).origin;
let context;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block", recordVideo: { dir: evidenceDir, size: { width: 1440, height: 900 } } });
  await attachGuard(context, origin, offOrigin);
  await context.addCookies(cookiesFromHeader(seeded.CORE_SMOKE_COOKIE, ready.url));
  const page = await context.newPage();
  page.on("response", (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) recordNav(navigations, response.url(), response.status());
  });
  const run = await runPlan({ page, plan, base: ready.url, projectId: seeded.CORE_SMOKE_PROJECT_ID, taskId: seeded.CORE_SMOKE_TASK_ID, bearer: seeded.CORE_SMOKE_MCP_TOKEN, shotsDir, navigations });
  writeEvidence({ ...binding, steps: run.steps, expects: run.expects, navigations, offOrigin });
} finally {
  await context?.close();
  await browser.close();
}
