import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { cookiesFromHeader, drivePlan, previewDownBody, readPlan, readSmokeEnv, smokeDriveIds, waitForPreview } from "./pstack-verifier.mjs";

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
const planFile = process.env.PSTACK_PLAN_FILE || path.join(work, "plan", "plan.json");
const plan = readPlan(readFileSync(planFile, "utf8"), binding);
const shotsDir = path.join(evidenceDir, "shots");
mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const run = await drivePlan({
    browser,
    plan,
    base: ready.url,
    origin: new URL(ready.url).origin,
    shotsRoot: shotsDir,
    evidenceDir,
    cookies: cookiesFromHeader(seeded.CORE_SMOKE_COOKIE, ready.url),
    ...smokeDriveIds(seeded),
  });
  writeEvidence({ ...binding, journeys: run.journeys, steps: run.steps, expects: run.expects, navigations: run.navigations, offOrigin: run.offOrigin });
} finally {
  await browser.close();
}
