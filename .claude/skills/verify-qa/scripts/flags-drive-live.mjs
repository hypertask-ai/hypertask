import path from "node:path";
import { driveMain } from "./drive-cli.mjs";

const REFUSAL_REASON = "https://app.hypertask.ai/detail/project-15/8940#comment-1";

await driveMain("flags", process.argv.slice(2), { refusal: "switch without an agent token is refused" }, async ({ base, dir, context, page, board, task, projectId, breakStep, step }) => {
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
  const status = await page.evaluate(async ({ key, reason }) => (await fetch("/api/mcp/flags", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, mode: "EVERYONE", reason }),
  })).status, { key, reason: REFUSAL_REASON });
  step("switch without an agent token is refused", status === 401 || status === 403, { status });
  const second = await (await context.request.get("/api/flags")).json();
  step("flag states stay unchanged", JSON.stringify(second?.flags) === JSON.stringify(flags), {});
});
