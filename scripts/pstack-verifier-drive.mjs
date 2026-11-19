import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { attachGuard, BASE_CACHE_DIR, cookiesFromHeader, previewDownBody, readPlan, readSmokeEnv, recordNav, runJourneys, smokeDriveIds, VIEWPORTS, waitForPreview, writeBaseCache } from "./pstack-verifier.mjs";

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
const origin = new URL(ready.url).origin;
const browser = await chromium.launch({ headless: true });
const startedAt = Date.now();
let run;
try {
  run = await runJourneys({
    plan,
    base: ready.url,
    ...smokeDriveIds(seeded),
    shotsRoot: shotsDir,
    viewports: VIEWPORTS.map((item) => item.name),
    openLane: async ({ viewport }) => {
      const options = VIEWPORTS.find((item) => item.name === viewport).options;
      const video = path.join(evidenceDir, "video", viewport);
      mkdirSync(video, { recursive: true });
      const context = await browser.newContext({ ...options, serviceWorkers: "block", recordVideo: { dir: video, size: options.viewport } });
      const offOrigin = [];
      await attachGuard(context, origin, offOrigin);
      await context.addCookies(cookiesFromHeader(seeded.CORE_SMOKE_COOKIE, ready.url));
      const page = await context.newPage();
      const current = { navigations: [] };
      page.on("response", (response) => {
        const request = response.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) recordNav(current.navigations, response.url(), response.status());
      });
      return { page, offOrigin, nextNavigations: () => (current.navigations = []), close: () => context.close() };
    },
  });
} finally {
  await browser.close();
}
writeEvidence({ ...binding, journeys: run.journeys, steps: run.steps, expects: run.expects, navigations: run.navigations, offOrigin: run.offOrigin });
console.log(`drive clock: ${Math.round((Date.now() - startedAt) / 1000)}s over ${run.journeys.length} journey runs`);
if (process.env.PSTACK_BASE_CACHE && process.env.BASE_SHA) {
  const written = writeBaseCache({ plan, evidence: { journeys: run.journeys }, dir: path.join(work, BASE_CACHE_DIR), baseSha: process.env.BASE_SHA, mapSha: process.env.GITHUB_SHA });
  console.log(`base cache entries written: ${written}`);
}
