const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { definitions } = require("./helpers/flag-files.cjs");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "src/prisma/migrations/20261022170000_drop_11_stale_flag_rows/migration.sql"),
  "utf8",
);
const staleKeys = [
  "htpr-6130-mobile-reminder-safe-area",
  "htpr-6154-chat-stop-and-timeout",
  "htpr-6197-confirmed-proposal-heading",
  "htpr-6278-chat-turn-failure-state",
  "htpr-6363-task-writer-research",
  "htpr-6372-search-ranking",
  "htpr-6553-agent-chat-polling",
  "htpr-6554-light-comment-separation",
  "htpr-6559-keep-direct-task-open-after-comment",
  "htpr-6561-preserve-ai-edited-description-structure",
  "htpr-6722-latest-models",
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "migrations" ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(entry.name) ? [full] : [];
  });
}

test("the migration deletes exactly the 11 stale keys and nothing else", () => {
  const deleted = [...migration.matchAll(/'([^']+)'/g)].map(([, key]) => key);
  assert.deepEqual(deleted, staleKeys);
});

test("no stale key is still defined or read anywhere in src", () => {
  const defined = new Set(definitions().map(({ key }) => key));
  assert.ok(defined.size > 0, "registry positive control");
  for (const key of staleKeys) assert.equal(defined.has(key), false, `${key} is still defined`);
  const files = sourceFiles(path.join(root, "src"));
  assert.ok(files.length > 100, "source scan positive control");
  const readers = files.filter((file) => staleKeys.some((key) => fs.readFileSync(file, "utf8").includes(key)));
  assert.deepEqual(readers, []);
});

test("still allowed: every flag defined in code keeps its row", () => {
  for (const { key } of definitions()) assert.equal(migration.includes(`'${key}'`), false, `${key} must not be deleted`);
});
