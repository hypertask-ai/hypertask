const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { modelIndexes, migrationIndexes } = require("./helpers/prisma-indexes.cjs");

const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "src/prisma/schema.prisma");
const migrationPath = path.join(
  root,
  "src/prisma/migrations/20261017120000_yper4_422_guest_cleanup_delete_indexes/migration.sql",
);

const cleaned = [
  ["Comment", "creatorId"],
  ["Description", "creatorId"],
  ["Notification", "assignId"],
  ["Notification", "commentId"],
];

const indexes = modelIndexes(fs.readFileSync(schemaPath, "utf8"));
const migration = migrationIndexes(fs.readFileSync(migrationPath, "utf8"));

test("guest cleanup deletes have an index that can serve each filtered column", () => {
  for (const [model, column] of cleaned) {
    const columns = indexes.get(model) ?? [];
    const covered = columns.some((index) => index[0] === column);
    assert.ok(covered, `${model} has no index led by ${column}`);
  }
});

test("the guest cleanup migration creates exactly the four indexes the deletes need", () => {
  assert.deepEqual(
    [...migration].sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: "Comment_creatorId_idx", table: "Comment", column: "creatorId" },
      { name: "Description_creatorId_idx", table: "Description", column: "creatorId" },
      { name: "Notification_assignId_idx", table: "Notification", column: "assignId" },
      { name: "Notification_commentId_idx", table: "Notification", column: "commentId" },
    ],
  );
});
