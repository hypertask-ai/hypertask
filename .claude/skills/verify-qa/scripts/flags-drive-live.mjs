#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { driveMain } from "./drive-cli.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BREAKS = { refusal: "switch without an agent token is refused" };
const REFUSAL_REASON = "https://app.hypertask.ai/detail/project-15/8940#comment-1";

async function run({ base, state, dir, breakStep, step }) {
  const { createRequire } = await import("node:module");
  const { chromium } = createRequire(path.join(root, "package.json"))("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: base, storageState: state, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    if (breakStep === "refusal") {
      await context.route("**/api/mcp/flags", (route) => {
        if (route.request().method() === "PATCH") return route.fulfill({ status: 200, contentType: "application/json", body: '{"flag":{"mode":"OFF"}}' });
        return route.continue();
      });
    }
    const first = await context.request.get("/api/flags");
    const firstBody = await first.json();
    const flags = firstBody?.flags ?? {};
    const key = Object.keys(flags).find((name) => typeof flags[name] === "boolean");
    await page.goto("/inbox?realtime=on", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.screenshot({ path: path.join(dir, "01-flags.png") });
    step("flag list has states", first.ok() && Boolean(key) && Object.values(flags).every((value) => typeof value === "boolean"), { count: Object.keys(flags).length });
    const refused = await context.request.fetch("/api/mcp/flags", {
      method: "PATCH",
      data: { key, mode: "EVERYONE", reason: REFUSAL_REASON },
    });
    const refusalText = await refused.text();
    step("switch without an agent token is refused", refused.status() === 401 || refused.status() === 403, { status: refused.status(), body: refusalText.slice(0, 180) });
    const second = await (await context.request.get("/api/flags")).json();
    step("flag states stay unchanged", JSON.stringify(second?.flags) === JSON.stringify(flags), {});
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await driveMain("flags", "flags drive", process.argv.slice(2), BREAKS, run);
