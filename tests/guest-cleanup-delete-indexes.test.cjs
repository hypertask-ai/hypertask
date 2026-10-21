const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");

function modelBody(schema, model) {
  const match = schema.match(new RegExp(`^model ${model} \\{\\n([\\s\\S]*?)^\\}`, "m"));
  assert.ok(match, `model ${model} exists`);
  return match[1];
}

test("guest cleanup deletes have an index on every column they filter or cascade through", () => {
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  assert.match(modelBody(schema, "Comment"), /^ {2}@@index\(\[creatorId\]\)$/m);
  assert.match(modelBody(schema, "Description"), /^ {2}@@index\(\[creatorId\]\)$/m);
  assert.match(modelBody(schema, "Notification"), /^ {2}@@index\(\[assignId\]\)$/m);
  assert.match(modelBody(schema, "Notification"), /^ {2}@@index\(\[commentId\]\)$/m);

  const migration = fs.readFileSync(path.join(root,
    "src/prisma/migrations/20261017120000_yper4_422_guest_cleanup_delete_indexes/migration.sql"), "utf8");
  const statements = migration.replace(/--[^\n]*/g, "").trim().split("\n");
  assert.deepEqual(statements, [
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_assignId_idx" ON "Notification"("assignId");',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_commentId_idx" ON "Notification"("commentId");',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Description_creatorId_idx" ON "Description"("creatorId");',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Comment_creatorId_idx" ON "Comment"("creatorId");',
  ]);
});
