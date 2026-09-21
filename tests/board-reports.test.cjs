const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const REPORT_ROUTES = [
  "src/app/api/reports/velocity/route.ts",
  "src/app/api/reports/status-update/route.ts",
  "src/app/api/mcp/reports/create/route.ts",
  "src/app/api/mcp/reports/delete/route.ts",
  "src/app/api/mcp/reports/get/route.ts",
  "src/app/api/mcp/reports/list/route.ts",
  "src/app/api/mcp/reports/update/route.ts",
];

test("every board report server surface enforces the ticket feature flag", () => {
  for (const relativePath of REPORT_ROUTES) {
    const route = source(relativePath);
    assert.match(route, /HTPR_6585_BOARD_REPORTS_FLAG/, relativePath);
    assert.match(route, /isFeatureEnabled\(/, relativePath);
    assert.match(route, /status: 404/, relativePath);
  }

  const layout = source("src/app/report/layout.tsx");
  assert.match(layout, /HTPR_6585_BOARD_REPORTS_FLAG/);
  assert.match(layout, /isFeatureEnabled\(/);
  assert.match(layout, /redirect\("\/unauthorized"\)/);
});

test("the reports hub requests a built-in dashboard only for the current board", () => {
  const page = source("src/app/report/page.tsx");
  const service = source("src/utils/controllers/reports/reportService.ts");

  assert.match(page, /cookieStore\.get\("previousBoard"\)/);
  assert.match(page, /listAllReportsForUser\([\s\S]*user\.id,[\s\S]*projectId/);
  assert.match(service, /currentProjectId\s*\?/);
  assert.match(service, /where: \{ id: currentProjectId, \.\.\.getProjectWhere\(userId\) \}/);
  assert.match(service, /: Promise\.resolve\(\[\]\)/);
});

test("board analytics exposes the required live ranges and worked-ticket links", () => {
  const ui = source(
    "src/app/report/[projectSlug]/velocity/VelocityReport.tsx"
  );
  const route = source("src/app/api/reports/velocity/route.ts");

  for (const label of ["Today", "Yesterday", "Last 7 days", "Custom range"]) {
    assert.match(source("src/lib/velocity.ts"), new RegExp(`label: "${label}"`));
  }
  assert.match(ui, /type="date"/);
  assert.match(ui, /refetchOnMount: "always"/);
  assert.match(ui, /refetchOnWindowFocus: true/);
  assert.match(ui, /<Link[\s\S]*task\.href/);
  assert.match(ui, /task\.mergedPullRequests\.map/);

  assert.match(route, /getAuthSession\(request\.headers\)/);
  assert.doesNotMatch(route, /nookies_user/);
  assert.match(route, /prisma\.comment\.groupBy\(\{[\s\S]*by: \["taskId"\]/);
  assert.match(route, /prisma\.taskSectionEvent\.groupBy\(\{/);
  assert.match(route, /prisma\.taskPullRequest\.groupBy\(\{/);
  assert.match(route, /take: WORKED_ON_TASK_LIMIT/);
  assert.match(route, /take: MERGED_PULL_REQUEST_LIMIT/);
  assert.match(ui, /value=\{customFrom\}/);
  assert.match(ui, /value=\{customTo\}/);
  assert.doesNotMatch(ui, /border border-border/);
});

test("report commands disappear when board reports are disabled", () => {
  const commands = source("src/components/Modals/commands/HTC/commands.tsx");
  assert.match(commands, /useFlag\(HTPR_6585_BOARD_REPORTS_FLAG\)/);
  for (const mode of [
    "GotoReports",
    "GotoBoardVelocityReport",
    "GenerateStatusUpdate",
  ]) {
    assert.match(commands, new RegExp(`CommandMode\\.${mode}`));
  }
});
