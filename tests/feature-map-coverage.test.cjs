const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { coverageReport } = require("../.github/scripts/feature-map-coverage.cjs");

const script = path.resolve(__dirname, "../.github/scripts/feature-map-coverage.cjs");

function write(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "feature-map-coverage-"));
  write(root, "src/app/inbox/page.tsx", "export default function Page() { return null }\n");
  write(root, "src/app/inbox-extra/page.tsx", "export default function Page() { return null }\n");
  write(root, "src/app/(tutorial space)/learn/page.tsx", "export default function Page() { return null }\n");
  write(root, "src/app/trash/[projectId]/page.tsx", "export default function Page() { return null }\n");
  write(root, "src/app/settings/[[...section]]/page.tsx", "export default function Page() { return null }\n");
  write(root, "src/lib/flags/definitions/demo-feature.ts", 'export const DEMO_FLAG =\n  "demo-feature"\nexport default { key: DEMO_FLAG, kind: "feature" }\n');
  write(root, "src/lib/flags/definitions/demo-bugfix.ts", 'export const BUG_FLAG = "demo-bugfix"\nexport default { key: BUG_FLAG, kind: "bugfix" }\n');
  write(root, ".claude/skills/verify-qa/reference/feature-map/inbox.md", "Open `/inbox` and `/learn`.\n");
  write(root, ".claude/skills/verify-qa/reference/feature-map/rows/inbox.md", "| Inbox |\n");
  return root;
}

function run(root, args, env = {}) {
  return spawnSync(process.execPath, [script, "--root", root, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("product screens and flags are counted and repairs are not", (t) => {
  const root = tree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const report = coverageReport(root);
  assert.equal(report.line, "2 of 6");
  assert.deepEqual(report.unmapped.map((feature) => feature.id), ["/inbox-extra", "/settings", "/trash/:projectId", "demo-feature"]);
  assert.equal(report.unmapped.some((feature) => feature.id === "demo-bugfix"), false);
  assert.equal(report.unmapped.some((feature) => feature.id === "/inbox"), false);
  assert.equal(report.unmapped.some((feature) => feature.id === "/learn"), false);
});

test("a page citation and a flag key clear those gaps", (t) => {
  const root = tree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, ".claude/skills/verify-qa/reference/feature-map/inbox.md", "Open `/inbox`, `/learn`, `/settings`, and `/trash/<boardId>`.\n`demo-feature` is on.\n");
  write(root, "src/app/inbox-extra/page.tsx", "export default function Page() { return null }\n");
  write(root, ".claude/skills/verify-qa/reference/feature-map/extra.md", "Open `src/app/inbox-extra/page.tsx`.\n");
  write(root, ".claude/skills/verify-qa/reference/feature-map/rows/extra.md", "| Extra |\n");
  const report = coverageReport(root);
  assert.equal(report.line, "6 of 6");
  assert.deepEqual(report.unmapped, []);
  assert.deepEqual(report.rowGaps, []);
});

test("strict mode fails while a feature is unmapped and passes when it is mapped", (t) => {
  const root = tree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gap = run(root, ["--strict", "--only", "/trash/:projectId"]);
  assert.equal(gap.status, 1);
  assert.match(gap.stdout, /^0 of 1\nUnmapped features:\n- \/trash\/:projectId\n$/);
  write(root, ".claude/skills/verify-qa/reference/feature-map/trash.md", "Open src/app/trash/[projectId]/page.tsx\n");
  write(root, ".claude/skills/verify-qa/reference/feature-map/rows/trash.md", "| Trash |\n");
  const covered = run(root, ["--strict", "--only", "/trash/:projectId"]);
  assert.equal(covered.status, 0);
  assert.match(covered.stdout, /^1 of 1\nUnmapped features:\n- none\n$/);
  const reportOnly = run(root, []);
  assert.equal(reportOnly.status, 0);
  assert.match(reportOnly.stdout, /^3 of 6\n/);
});

test("a dynamic route is not mapped by a shared prefix", (t) => {
  const root = tree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "src/app/chat/[sessionId]/page.tsx", "export default function Page() { return null }\n");
  write(root, ".claude/skills/verify-qa/reference/feature-map/inbox.md", "Call `/api/mcp/chat/rooms/pending` and open `/chat/rooms`.\n");
  assert.equal(coverageReport(root, { only: "/chat/:sessionId" }).line, "0 of 1");
  write(root, ".claude/skills/verify-qa/reference/feature-map/inbox.md", "Open `/chat/<session>`.\n");
  assert.equal(coverageReport(root, { only: "/chat/:sessionId" }).line, "1 of 1");
});

test("a missing feature name and a step summary are explicit", (t) => {
  const root = tree();
  const summary = path.join(root, "summary.md");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unknown = run(root, ["--only", "missing-feature"]);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /unknown feature missing-feature/);
  const reported = run(root, ["--only", "/inbox"], { GITHUB_STEP_SUMMARY: summary });
  assert.equal(reported.status, 0);
  assert.equal(fs.readFileSync(summary, "utf8"), reported.stdout);
});
