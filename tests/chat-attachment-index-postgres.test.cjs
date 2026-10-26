const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.join(__dirname,
  "../src/prisma/migrations/20261026224500_yper4_739_chat_attachment_index/migration.sql"), "utf8");
const image = process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";

function nodes(plan) {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

test("chat attachment lookup preserves transcripts without repeated full attachment scans", { timeout: 120_000 }, (t) => {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (docker.status !== 0) {
    if (process.env.HT_REQUIRE_PG_TESTS === "1") assert.fail("Docker is required for attachment index proof");
    t.skip("Docker is unavailable");
    return;
  }
  const lookup = `SELECT m.id, a.attachments FROM "ChatMessage" m
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(a ORDER BY a.id), '[]'::jsonb) AS attachments
      FROM "Attachment" a WHERE a."chatMessageId" = m.id
    ) a ON true ORDER BY m.id`;
  const result = spawnSync("docker", ["run", "--rm", "-i", "--network", "none", "--user", "postgres", image,
    "sh", "-c", "initdb -D /tmp/attachment-pg -A trust >/tmp/init.log && pg_ctl -D /tmp/attachment-pg -w -l /tmp/pg.log start >/tmp/start.log && psql -U postgres -v ON_ERROR_STOP=1 -At"], {
    encoding: "utf8", timeout: 110_000, maxBuffer: 4 * 1024 * 1024,
    input: `
      CREATE TABLE "ChatMessage" (id text PRIMARY KEY);
      CREATE TABLE "Attachment" (id int PRIMARY KEY, "chatMessageId" text REFERENCES "ChatMessage"(id), "fileName" text);
      INSERT INTO "ChatMessage" SELECT 'message-' || i FROM generate_series(1, 1623) i;
      INSERT INTO "Attachment" SELECT i, CASE WHEN i <= 1623 THEN 'message-' || i END, 'file-' || i FROM generate_series(1, 21623) i;
      ANALYZE;
      CREATE TEMP TABLE baseline AS ${lookup};
      SELECT 'BEFORE_PLAN';
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lookup};
      ${migration}
      SELECT 'AFTER_PLAN';
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lookup};
      DO $$ BEGIN
        IF EXISTS ((SELECT * FROM baseline EXCEPT ALL (${lookup})) UNION ALL ((${lookup}) EXCEPT ALL SELECT * FROM baseline))
        THEN RAISE EXCEPTION 'Transcript attachment content changed'; END IF;
      END $$;
      ${migration}
      INSERT INTO "Attachment" VALUES (21624, 'message-1', 'new-upload');
      SELECT 'INDEX_VALID=' || indisvalid FROM pg_index WHERE indexrelid = '"Attachment_chatMessageId_idx"'::regclass;
      SELECT 'UPLOADS=' || count(*) FROM "Attachment" WHERE "chatMessageId" = 'message-1';
      SELECT 'SESSIONS=' || count(*) FROM baseline;
    `,
  });
  assert.equal(result.status, 0, [result.error?.message, result.stderr, result.stdout].filter(Boolean).join("\n"));
  const before = JSON.parse(result.stdout.split("BEFORE_PLAN\n")[1].split("CREATE INDEX")[0]);
  const after = JSON.parse(result.stdout.split("AFTER_PLAN\n")[1].split("DO\n")[0]);
  const beforeScan = nodes(before[0].Plan).find((node) => node["Relation Name"] === "Attachment");
  const afterScan = nodes(after[0].Plan).find((node) => node["Relation Name"] === "Attachment");
  assert.equal(beforeScan["Node Type"], "Seq Scan");
  assert.equal(beforeScan["Actual Loops"], 1623);
  assert.equal(afterScan["Node Type"], "Index Scan");
  assert.equal(afterScan["Index Name"], "Attachment_chatMessageId_idx");
  assert.equal(afterScan["Actual Loops"], 1623);
  assert.equal(afterScan["Actual Rows"], 1);
  assert.ok(afterScan["Shared Hit Blocks"] < beforeScan["Shared Hit Blocks"], "index must reduce attachment buffer work");
  assert.match(result.stdout, /INDEX_VALID=true/);
  assert.match(result.stdout, /UPLOADS=2/);
  assert.match(result.stdout, /SESSIONS=1623/);
  console.log(JSON.stringify({ synthetic: true, sessions: 1623, beforeAttachmentBlocks: beforeScan["Shared Hit Blocks"], afterAttachmentBlocks: afterScan["Shared Hit Blocks"], exactTranscriptMatch: true }));
  console.log("attachment index proof ok");
});
