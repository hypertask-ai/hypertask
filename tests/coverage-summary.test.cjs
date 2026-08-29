const assert = require("node:assert/strict");
const test = require("node:test");

test("coverage baseline groups critical domains and ranks uncovered lines", async () => {
  const { buildCoverageBaseline } = await import(
    "../scripts/coverage-summary.mjs"
  );
  const metric = (total, covered) => ({ total, covered, skipped: 0, pct: 0 });
  const baseline = buildCoverageBaseline(
    {
      total: {},
      "/repo/src/lib/auth/session.ts": {
        statements: metric(10, 5),
        branches: metric(4, 1),
        functions: metric(3, 1),
        lines: metric(10, 5),
      },
      "/repo/src/app/api/tasks/create/route.ts": {
        statements: metric(20, 2),
        branches: metric(8, 0),
        functions: metric(4, 1),
        lines: metric(20, 2),
      },
      "/repo/src/components/Button.tsx": {
        statements: metric(4, 4),
        branches: metric(2, 2),
        functions: metric(1, 1),
        lines: metric(4, 4),
      },
    },
    { root: "/repo" },
  );

  const auth = baseline.domains.find((domain) => domain.id === "auth_access");
  const tasks = baseline.domains.find((domain) => domain.id === "task_writes");
  const other = baseline.domains.find(
    (domain) => domain.id === "other_production",
  );

  assert.equal(auth.lines.pct, 50);
  assert.equal(tasks.lines.pct, 10);
  assert.equal(other.lines.pct, 100);
  assert.equal(
    baseline.largestCriticalGaps[0].file,
    "src/app/api/tasks/create/route.ts",
  );
  assert.equal(baseline.reportOnly, true);
});

test("coverage markdown explicitly says the baseline is not a merge threshold", async () => {
  const { buildCoverageBaseline, renderCoverageMarkdown } = await import(
    "../scripts/coverage-summary.mjs"
  );
  const markdown = renderCoverageMarkdown(buildCoverageBaseline({}, { root: "/repo" }));

  assert.match(markdown, /diagnostic, not a merge threshold/i);
  assert.match(markdown, /Auth \/ access/);
  assert.match(markdown, /Largest critical gaps/);
});
