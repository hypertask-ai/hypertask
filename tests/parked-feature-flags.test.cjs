const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { createJiti } = require("jiti");
const root = path.resolve(__dirname, "..");
let saved = [];
let writes = 0;
const prisma = {
  user: { findUnique: async () => ({ email: "valentin.yeo@gmail.com" }) },
  featureFlag: { findMany: async () => saved, upsert: async () => { writes++; throw new Error("Unexpected mode write"); } },
};
for (const [filename, exports] of [
  ["src/lib/prisma.ts", { default: prisma }],
  ["src/lib/auth/getSessionUser.ts", { getSessionUser: async () => ({ userId: 6 }) }],
]) {
  const id = path.join(root, filename);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const flags = jiti(path.join(root, "src/lib/flags.ts"));
const { PARKED_FLAGS } = jiti(path.join(root, "src/lib/flags/parked.ts"));
const { FEATURE_FLAG_DEFINITIONS } = jiti(path.join(root, "src/lib/flags/definitions.ts"));
const cluster = jiti(path.join(root, "src/lib/flags/cluster.ts"));
const filters = jiti(path.join(root, "src/app/admin/flags/useFlagsPageFilters.ts"));
const { FEATURE_FLAG_RELEASE_RISKS } = jiti(path.join(root, "src/lib/flags/releaseRisk.ts"));
const reason = "Waiting on the Paperclip decision (HTPR-7059)";
const parked = [
  "htpr-6006-chat-confirm-ticket", "htpr-6512-seed-team-agent", "htpr-6243-manager-loop-activity",
  "htpr-6283-agent-chat-live-sort", "htpr-6284-agent-mention-routing", "htpr-6287-agent-chat-roster-status",
  "htpr-6407-mobile-agent-chat-layout", "htpr-6476-mobile-agent-chat-fullscreen", "htpr-6094-agent-activity-rows",
  "htpr-6002-shared-agent-chat", "htpr-6557-agent-rooms", "htpr-6155-chat-agent-brief",
  "htpr-6154-chat-stop-and-timeout", "htpr-6197-confirmed-proposal-heading", "htpr-6553-agent-chat-polling",
].sort();
const fixture = (key, mode, parked) => ({ key, mode, parked, shippedOn: "2026-10-01", updatedAt: null });

test("the registry parks the full specified and chat-exclusive set with the agreed reason", () => {
  assert.deepEqual(Object.keys(PARKED_FLAGS).sort(), parked);
  for (const key of parked) assert.equal(PARKED_FLAGS[key].reason, reason);
  for (const key of ["htpr-6278-chat-turn-failure-state", "htpr-6354-ai-chat-alerts", "htpr-6551-quiet-run-activity", "htpr-6115-agent-sdk", "htpr-6122-agent-run-activities"]) {
    assert.equal(PARKED_FLAGS[key], undefined, `${key} is shared outside Agent Chat`);
  }
});

test("parking preserves every stored mode and does not write the database", async () => {
  for (const mode of flags.FEATURE_FLAG_MODES) {
    saved = parked.map((key) => ({ key, mode, updatedAt: new Date("2026-10-01"), releasedAt: null, keep: false, removalTaskId: null }));
    const rows = await flags.listFeatureFlagModes();
    for (const key of parked) {
      const row = rows.find((row) => row.key === key);
      assert.equal(row.mode, mode);
      assert.equal(row.parked.reason, reason);
    }
  }
  assert.equal(writes, 0);
});

test("Parked URL filter round-trips and composes with existing filters", () => {
  const parsed = filters.parseFlagsPageFilters("tab=parked&type=bug,feature&risk=small&q=agent&sort=oldest");
  assert.equal(parsed.audience, "PARKED");
  assert.deepEqual(filters.parseFlagsPageFilters(filters.serializeFlagsPageFilters(parsed)), parsed);
});

test("parked rows are excluded from Unreleased and count in every mode under both existing filter modes", () => {
  const rows = [
    ...flags.FEATURE_FLAG_MODES.map((mode) => fixture(`parked-${mode}`, mode, { reason })),
    ...flags.FEATURE_FLAG_MODES.map((mode) => fixture(`active-${mode}`, mode)),
  ];
  const originalModes = rows.map((row) => row.mode);
  for (const unreleasedOnly of [false, true]) {
    const counts = cluster.countFeatureFlagsByAudience(rows, unreleasedOnly);
    assert.equal(counts.PARKED, 4);
    assert.equal(counts.UNRELEASED, unreleasedOnly ? 2 : 3);
    for (const mode of flags.FEATURE_FLAG_MODES) assert.equal(counts[mode], 2);
    const matching = (audience) => cluster.clusterFeatureFlagsByReleaseDate(rows, "desc", audience, { unreleasedOnly }).flatMap(([, rows]) => rows);
    assert.equal(matching("PARKED").length, 4);
    assert.ok(matching("PARKED").every((row) => row.parked));
    assert.ok(matching("UNRELEASED").every((row) => !row.parked));
    assert.equal(matching("UNRELEASED").length, counts.UNRELEASED);
    assert.equal(matching("ALL").length, rows.length);
  }
  for (const row of rows.filter((row) => row.parked)) {
    assert.equal(cluster.isUnreleasedFeatureFlag(row), false);
    assert.equal(filters.flagDaysWaiting(row), null);
  }
  assert.deepEqual(rows.map((row) => row.mode), originalModes);
});

test("the parked page flag is a small-risk feature and badge markup is in its render branch", () => {
  const definition = FEATURE_FLAG_DEFINITIONS.find((row) => row.key === "htpr-7070-parked-flags");
  assert.equal(definition.kind, "feature");
  assert.equal(flags.defaultFeatureFlagMode(definition.key), "OWNER_AND_QA");
  assert.equal(FEATURE_FLAG_RELEASE_RISKS[definition.key].risk, "small");
  const source = fs.readFileSync(path.join(root, "src/app/admin/flags/FeatureFlagsAdmin.tsx"), "utf8");
  assert.match(source, /useFlag\(HTPR_7070_PARKED_FLAGS_FLAG\)/);
  assert.match(source, /if \(parkedEnabled\) \{[\s\S]*?<LabelWrapper[\s\S]*?Parked: \{flag\.parked\.reason\}/);
  assert.match(source, /parkedEnabled \|\| !flag\.parked \? flag : \{ \.\.\.flag, parked: undefined \}/);
  assert.match(source, /requestedAudienceFilter === "PARKED" && !parkedEnabled \? "ALL"/);
});
