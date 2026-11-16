const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const key = "htpr-7518-agent-sidebar-chats";
const migration = "src/prisma/migrations/20261116090000_drop_htpr_7518_agent_sidebar_chats_flag/migration.sql";

function sourceReferences(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceReferences(file);
    if (!/\.tsx?$/.test(entry.name) || entry.name === "index.generated.ts") return [];
    const source = fs.readFileSync(file, "utf8");
    return source.includes(key) ? [path.relative(root, file)] : [];
  });
}

test("the sidebar chat rollout is permanent and its stored switch is gone", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${key}.ts`)), false);
  assert.deepEqual(
    sourceReferences(path.join(root, "src")).filter((file) => file !== "src/lib/flags.ts"),
    [],
  );
  assert.equal(
    fs.readFileSync(path.join(root, migration), "utf8"),
    `DELETE FROM "FeatureFlag" WHERE "key" = '${key}';\n`,
  );
  const modes = JSON.parse(
    fs.readFileSync(path.join(root, "e2e/smoke/production-flag-modes.json"), "utf8"),
  );
  assert.equal(JSON.stringify(modes).includes(key), false);
  assert.equal(fs.existsSync(path.join(root, "e2e/smoke/flag-modes", `${key}.json`)), false);
});

test("sidebar board access opens without asking a rollout switch", async () => {
  const board = { id: 15 };
  const access = loadModule("src/lib/agents/chatAccess.ts", {
    "@/lib/prisma": { default: { project: { findFirst: async () => board } } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/agents/visibility": { accessibleAgentWhere: () => ({}) },
    "./chatContentScope": { chatAudienceWhere: () => ({}), chatContentScopeWhere: () => ({}) },
  });
  assert.deepEqual(await access.loadSidebarChatBoard(6, 15), board);
  assert.equal(await access.loadSidebarChatBoard(6, 0), null);
  assert.equal(await access.loadSidebarChatBoard(6, 15, "agent-1"), null);
});
