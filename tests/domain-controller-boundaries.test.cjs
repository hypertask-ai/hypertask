const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const filesUnder = (relativePath) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(fullPath);
    }
  };
  visit(path.join(root, relativePath));
  return files;
};

test("chat transports share the chat controller", () => {
  const transports = [
    "src/app/api/ai/chat",
    "src/app/api/ai-chat",
    "src/app/api/agent-chat",
    "src/app/api/mcp/chat",
    "src/app/api/demo/chat",
  ];
  for (const transport of transports) {
    const source = filesUnder(transport).map((file) => fs.readFileSync(file, "utf8")).join("\n");
    assert.match(source, /@\/utils\/controllers\/chat/, transport);
  }
});

test("route files do not own custom field, label, or agent-list queries", () => {
  const source = ["src/app", "src/pages/api"]
    .flatMap(filesUnder)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /prisma\.customField/);
  assert.doesNotMatch(source, /prisma\.label/);
  assert.doesNotMatch(source, /prisma\.agent\.findMany/);
});

test("browser and MCP routes import the same domain controllers", () => {
  const pairs = [
    ["src/app/api/customFields/route.ts", "src/app/api/mcp/custom-fields/route.ts", "customFields"],
    ["src/pages/api/labels/createLabel.ts", "src/app/api/mcp/projects/[projectId]/labels/route.ts", "labels"],
    ["src/app/api/agents/route.ts", "src/app/api/mcp/agents/route.ts", "agents"],
    ["src/pages/api/notifications/getAll.ts", "src/app/api/mcp/inbox/list/route.ts", "notifications"],
    ["src/pages/api/projects/views/create-view.ts", "src/app/api/mcp/view/route.ts", "views"],
  ];
  for (const [browserRoute, mcpRoute, controller] of pairs) {
    const importPattern = new RegExp(`@/utils/controllers/${controller}`);
    assert.match(read(browserRoute), importPattern, browserRoute);
    assert.match(read(mcpRoute), importPattern, mcpRoute);
  }
});

test("named dead API routes are gone and migrations are not public endpoints", () => {
  const removed = [
    "src/pages/api/tasks/getAll.ts",
    "src/pages/api/projects/detail.ts",
    "src/pages/api/comments/getCount.ts",
    "src/pages/api/import_from_clickup.ts",
    "src/pages/api/projects/detailHelper.ts",
    "src/pages/api/comments/getCountByTask.ts",
    "src/pages/api/hello.ts",
    "src/pages/api/account_team_migration.ts",
    "src/pages/api/addProjectIdentifiers.ts",
    "src/pages/api/addStripeToAllTeamsExisting.ts",
    "src/pages/api/migrateAllDescriptions.ts",
    "src/pages/api/upsertAllTasksbyteamId.ts",
    "src/pages/api/migrate_archivedAt_to_all.ts",
    "src/pages/api/migrate_notifications_add_from.ts",
    "src/pages/api/migrate_views.ts",
  ];
  for (const relativePath of removed) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, relativePath);
  }
});
