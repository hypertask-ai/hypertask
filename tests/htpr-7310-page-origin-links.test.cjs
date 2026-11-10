const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sql = fs.readFileSync(
  path.join(__dirname, "../src/prisma/migrations/20261110100000_htpr_7310_page_origin_links/migration.sql"),
  "utf8",
);

test("HTPR-7310 migration reconciles missing origin links and guards before commit", () => {
  assert.match(sql, /INSERT INTO "PageTaskLink"/);
  assert.match(sql, /WHERE p\."taskId" IS NOT NULL/);
  assert.match(sql, /ON CONFLICT \("pageId", "taskId"\) DO NOTHING/);
  assert.match(sql, /RAISE EXCEPTION 'HTPR-7310: page origin ticket missing PageTaskLink row'/);
  assert.doesNotMatch(sql, /DROP COLUMN "taskId"/);
});
