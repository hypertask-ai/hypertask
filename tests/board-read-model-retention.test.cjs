const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const jiti = createJiti(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

// boardRetentionEvictionKeys lives in its own side-effect-free module.
// Loading indexedDbReadModel.ts directly opens a BroadcastChannel and hangs
// a plain Node process (see the existing board-sync-read-model.test.cjs
// comment on the same trap).
const { boardRetentionEvictionKeys } = jiti(
  path.join(root, "src/lib/boardSync/retention.ts"),
);

test("HTPR-5753: keeps the 3 most-recently-written records, oldest evicted first", () => {
  const others = [
    { key: "1:1:A", recency: "2026-08-20T00:00:00.000Z" },
    { key: "1:1:B", recency: "2026-08-25T00:00:00.000Z" },
    { key: "1:1:C", recency: "2026-08-28T00:00:00.000Z" },
  ];
  // "1:1:D" is the board just written -- always kept, takes one of the 3 slots.
  const evicted = boardRetentionEvictionKeys(others, "1:1:D", 3);
  assert.deepEqual(evicted, ["1:1:A"]);
});

test("HTPR-5753: a revoked board is evicted like any other record once it ages out of the top 3", () => {
  // Revoke A (old revokedAt), then write B, C, D on later days -- team-lead's
  // scenario: A's record must fall out of retention exactly like a snapshot
  // would, never lingering as a stale entry.
  const revokedA = { key: "1:1:A", recency: "2026-08-01T00:00:00.000Z" };
  const boardB = { key: "1:1:B", recency: "2026-08-20T00:00:00.000Z" };
  const boardC = { key: "1:1:C", recency: "2026-08-25T00:00:00.000Z" };

  const evicted = boardRetentionEvictionKeys(
    [revokedA, boardB, boardC],
    "1:1:D",
    3,
  );
  assert.deepEqual(evicted, ["1:1:A"]);
});

test("HTPR-5753: a record with no readable recency is evicted first", () => {
  const noRecency = { key: "1:1:A", recency: "" };
  const boardB = { key: "1:1:B", recency: "2026-08-20T00:00:00.000Z" };
  const boardC = { key: "1:1:C", recency: "2026-08-25T00:00:00.000Z" };

  const evicted = boardRetentionEvictionKeys(
    [noRecency, boardB, boardC],
    "1:1:D",
    3,
  );
  assert.deepEqual(evicted, ["1:1:A"]);
});

test("HTPR-5753: fewer records than the retention limit evicts nothing", () => {
  const boardB = { key: "1:1:B", recency: "2026-08-20T00:00:00.000Z" };
  assert.deepEqual(boardRetentionEvictionKeys([boardB], "1:1:D", 3), []);
});

test("HTPR-5753: source wiring -- eviction is whole-record, count is 3, and the pilot comment reflects it", () => {
  const retentionSource = read("src/lib/boardSync/retention.ts");
  const readModelSource = read("src/lib/boardSync/indexedDbReadModel.ts");

  assert.match(retentionSource, /export const RETENTION_LIMIT = 3;/);
  assert.match(
    readModelSource,
    /boardRetentionEvictionKeys\(otherRecords, snapshot\.key\)\.forEach\(\(key\) =>\s*store\.delete\(key\),?\s*\)/,
    "eviction must delete whole records by key, never a sub-field",
  );
  assert.doesNotMatch(
    readModelSource,
    /one active board per account/,
    "the single-slot pilot comment must be replaced now that N=3 boards are retained",
  );
  assert.match(
    readModelSource,
    /recordRecency[\s\S]*?savedAt[\s\S]*?revokedAt/,
    "recency must be read from both snapshots (savedAt) and revocation stubs (revokedAt)",
  );
});
