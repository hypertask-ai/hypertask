// HTPR-4671 gate 1: the migration's jti and sha256 extraction reproduces exactly
// what Node computes, on a real Postgres, across every base64url padding class.
import assert from "node:assert/strict";
import { ensurePostgres, psql, sampleTokens, loadTokens } from "./lib.mjs";

ensurePostgres();

const rows = sampleTokens(200);
const pads = new Set(rows.map((r) => r.pad));
assert.deepEqual([...pads].sort(), [0, 2, 3], `padding classes covered: ${[...pads]}`);

psql(`DROP TABLE IF EXISTS backfill_probe; CREATE TABLE backfill_probe(i int, "mcpToken" text);`);
loadTokens(rows, "backfill_probe");

const out = psql(`
  SELECT i,
    convert_from(
      decode(
        translate(split_part("mcpToken", '.', 2), '-_', '+/')
          || repeat('=', (4 - length(split_part("mcpToken", '.', 2)) % 4) % 4),
        'base64'
      ), 'UTF8'
    )::jsonb ->> 'jti',
    encode(sha256("mcpToken"::bytea), 'hex')
  FROM backfill_probe ORDER BY i;
`);

const got = new Map(
  out.trim().split("\n").map((line) => {
    const [i, jti, hash] = line.split("\t");
    return [Number(i), { jti, hash }];
  }),
);

assert.equal(got.size, rows.length);
for (const row of rows) {
  const actual = got.get(row.i);
  assert.equal(actual.jti, row.jti, `jti mismatch at row ${row.i} (padding ${row.pad})`);
  assert.equal(actual.hash, row.hash, `hash mismatch at row ${row.i}`);
}

// Positive control: a deliberately corrupted expectation must fail this oracle.
assert.throws(() => assert.equal(got.get(0).jti, rows[0].jti + "x"));

console.log(`${rows.length} tokens, padding classes ${[...pads].sort()}, jti and sha256 match Node exactly`);
console.log("HTPR4671_BACKFILL_SQL_OK");
