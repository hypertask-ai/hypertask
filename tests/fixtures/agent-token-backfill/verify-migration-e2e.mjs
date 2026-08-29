// HTPR-4671 gate 2: the real migration file, applied to a Postgres holding
// plaintext rows, leaves every agent's digest and generation matching its
// original token and removes the plaintext column.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { ensurePostgres, psql, psqlFile, sampleTokens, loadTokens } from "./lib.mjs";

// Four levels up from tests/fixtures/agent-token-backfill/ is the repo root.
const repo = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "../../..",
);
const migration = path.join(
  repo,
  "src/prisma/migrations/20260824120000_hash_agent_mcp_tokens/migration.sql",
);
const sql = fs.readFileSync(migration, "utf8");

ensurePostgres();

const rows = sampleTokens(120);
psql(`DROP TABLE IF EXISTS "Agent"; CREATE TABLE "Agent"(i int, id text, "mcpToken" text);`);
loadTokens(rows, '"Agent"');
// Rows the migration has to survive: no credential at all, and a stored value
// that is not a JWT (nothing that could ever have authenticated).
psql(`INSERT INTO "Agent"(i, id, "mcpToken") VALUES
  (9001, 'no-token', NULL),
  (9002, 'junk', 'not-a-jwt'),
  (9003, 'three-garbage-parts', 'aaa.!!!not-base64!!!.bbb'),
  (9004, 'decodes-but-not-json', 'aaa.bm90LWpzb24.bbb'),
  (9005, 'json-without-jti', 'aaa.eyJhZ2VudElkIjoieCJ9.bbb');`);

psqlFile(sql);

const columns = psql(`SELECT column_name FROM information_schema.columns WHERE table_name = 'Agent' ORDER BY column_name;`)
  .trim().split("\n").map((s) => s.trim());
assert.ok(!columns.includes("mcpToken"), `plaintext column survived: ${columns}`);
assert.ok(columns.includes("mcpTokenHash"), `hash column missing: ${columns}`);
assert.ok(columns.includes("mcpTokenJti"), `jti column missing: ${columns}`);

const out = psql(`SELECT i, coalesce("mcpTokenHash", 'NONE'), coalesce("mcpTokenJti", 'NONE') FROM "Agent" ORDER BY i;`);
const got = new Map(
  out.trim().split("\n").map((line) => {
    const [i, hash, jti] = line.split("\t");
    return [Number(i), { hash, jti }];
  }),
);

for (const row of rows) {
  const actual = got.get(row.i);
  assert.equal(actual.hash, row.hash, `row ${row.i} digest does not match its original token`);
  assert.equal(actual.jti, row.jti, `row ${row.i} generation does not match its original token`);
}
// A row with no credential stays empty; an unparseable one is cleared rather
// than left as a digest revocation could never match.
assert.deepEqual(got.get(9001), { hash: "NONE", jti: "NONE" });
for (const edge of [9002, 9003, 9004, 9005]) {
  assert.deepEqual(got.get(edge), { hash: "NONE", jti: "NONE" }, `edge row ${edge} was not cleared`);
}

// Positive control: the oracle fails when an expectation is wrong.
assert.throws(() => assert.equal(got.get(rows[0].i).hash, rows[0].hash + "x"));

console.log(`migration applied: ${rows.length} credentialed rows backfilled, 5 edge rows cleared, plaintext column dropped`);
console.log("HTPR4671_MIGRATION_E2E_OK");
