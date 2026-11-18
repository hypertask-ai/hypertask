import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { countsFromLegacySeedSource, seedSizeReport } from "../../scripts/lib/core-smoke-seed-plan.mjs";

export async function inspectRoot(root) {
  const planFile = path.join(root, "scripts/lib/core-smoke-seed-plan.mjs");
  if (existsSync(planFile)) {
    const mod = await import(pathToFileURL(planFile));
    const plan = mod.buildCoreSmokeSeedPlan({ runKey: "proof" });
    const report = mod.seedSizeReport(mod.summarizePlan(plan));
    const seedFile = path.join(root, "scripts/seed-core-actions-smoke.mjs");
    const source = existsSync(seedFile) ? readFileSync(seedFile, "utf8") : "";
    const gaps = mod.seedImplementationGaps(plan, source);
    if (report.code === 0 && gaps.length === 0) return report;
    return {
      code: 1,
      lines: [
        "core-smoke-seed-size fail",
        ...(report.code === 0 ? [] : report.lines.slice(1, -1)),
        ...gaps.map((gap) => `core-smoke-seed-size ${gap}`),
        report.lines.at(-1),
      ],
    };
  }
  const seedFile = path.join(root, "scripts/seed-core-actions-smoke.mjs");
  if (!existsSync(seedFile)) return { code: 1, lines: ["core-smoke-seed-size fail no seed script"] };
  return seedSizeReport(countsFromLegacySeedSource(readFileSync(seedFile, "utf8")));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag === -1 ? path.resolve(import.meta.dirname, "../..") : path.resolve(process.argv[rootFlag + 1]);
  const report = await inspectRoot(root);
  for (const line of report.lines) console.log(line);
  process.exitCode = report.code;
}
