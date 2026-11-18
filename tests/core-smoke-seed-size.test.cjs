const test = require("node:test");
const assert = require("node:assert/strict");
const { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");

test("smoke seed plan is real-team size and a one-ticket seed fails", async () => {
  const planMod = await import(pathToFileURL(path.join(root, "scripts/lib/core-smoke-seed-plan.mjs")).href);
  const { inspectRoot } = await import(pathToFileURL(path.join(root, ".github/scripts/core-smoke-seed-size.mjs")).href);
  const plan = planMod.buildCoreSmokeSeedPlan({ runKey: "size" });
  const counts = planMod.summarizePlan(plan);
  assert.equal(planMod.seedSizeReport(counts).code, 0);
  assert.equal(counts.boards, 3);
  assert.equal(counts.members, 8);
  assert.equal(counts.tickets, 210);
  assert.ok(counts.labels >= 1);
  assert.ok(counts.comments >= 1);
  assert.ok(counts.sectionsUsed >= 2);
  assert.deepEqual(plan.boards[0].sections, ["Baseline", "Alternate"]);
  assert.equal(plan.tasks.find((task) => task.boardKey === "fixture" && task.uniqueIndex === 1).title, "Core actions smoke fixture");
  for (const board of plan.boards) {
    for (const section of board.sections) {
      assert.ok(plan.tasks.some((task) => task.boardKey === board.key && task.sectionTitle === section));
    }
  }
  assert.equal(planMod.seedSizeReport({ ...counts, tickets: 1 }).code, 1);
  assert.equal(planMod.seedSizeReport({ ...counts, tickets: 250 }).code, 1);
  const bare = mkdtempSync(path.join(tmpdir(), "seed-size-"));
  mkdirSync(path.join(bare, "scripts"));
  writeFileSync(
    path.join(bare, "scripts", "seed-core-actions-smoke.mjs"),
    "prisma.project.create(\nprisma.section.create(\nprisma.section.create(\nprisma.member.create(\nprisma.task.create(\n",
  );
  const legacy = await inspectRoot(bare);
  assert.equal(legacy.code, 1);
  assert.match(legacy.lines.join("\n"), /tickets 1 is below 200/);
  assert.match(legacy.lines.join("\n"), /members 1 is below 8/);
  const live = await inspectRoot(root);
  assert.equal(live.code, 0, live.lines.join("\n"));
  assert.equal(planMod.teamRoster(plan).length, plan.members.length - 1);
  assert.ok(planMod.teamRoster(plan).every((member) => member.owner === false));
  assert.ok(planMod.boardRecords(plan, "ga").every((board) => board.googleAccountId === "ga"));
  assert.deepEqual(planMod.seedImplementationGaps(plan, readFileSync(path.join(root, "scripts/seed-core-actions-smoke.mjs"), "utf8")), []);
  const broken = mkdtempSync(path.join(tmpdir(), "seed-size-plan-"));
  mkdirSync(path.join(broken, "scripts/lib"), { recursive: true });
  copyFileSync(path.join(root, "scripts/lib/core-smoke-seed-plan.mjs"), path.join(broken, "scripts/lib/core-smoke-seed-plan.mjs"));
  writeFileSync(path.join(broken, "scripts/seed-core-actions-smoke.mjs"), "prisma.task.create(\n");
  const ignored = await inspectRoot(broken);
  assert.equal(ignored.code, 1);
  assert.match(ignored.lines.join("\n"), /seed missing buildCoreSmokeSeedPlan/);
});
