const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts/flags/flag-removal-candidates.mjs");

test("an Everyone streak restarts when the snapshot leaves Everyone", async () => {
  const { streakStarts } = await import("../scripts/flags/flag-removal-candidates.mjs");
  const since = streakStarts([
    { date: "2026-10-01T00:00:00.000Z", modes: { "htpr-7702-phone-chat-list": "EVERYONE", "htpr-3533-google-calendar": "EVERYONE" } },
    { date: "2026-10-10T00:00:00.000Z", modes: { "htpr-7702-phone-chat-list": "OFF", "htpr-3533-google-calendar": "EVERYONE" } },
    { date: "2026-10-12T00:00:00.000Z", modes: { "htpr-7702-phone-chat-list": "EVERYONE" } },
  ]);
  assert.deepEqual(since, {
    "htpr-7702-phone-chat-list": "2026-10-12T00:00:00.000Z",
    "htpr-3533-google-calendar": "2026-10-01T00:00:00.000Z",
  });
});

test("dry run lists flags past their window and a rerun files nothing new", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-removal-"));
  const snapshot = path.join(dir, "snapshot.json");
  const sinceFile = path.join(dir, "since.json");
  const firstFile = path.join(dir, "first.json");
  const now = "2026-10-24T00:00:00.000Z";
  fs.writeFileSync(snapshot, JSON.stringify({
    capturedAt: "2026-10-22T00:00:00.000Z",
    modes: {
      "htpr-3533-google-calendar": "EVERYONE",
      "htpr-7308-phone-layout-width": "EVERYONE",
      "htpr-7324-plan-ai-caps": "EVERYONE",
      "htpr-7350-card-title-wrap": "OWNER_AND_QA",
      "htpr-7702-phone-chat-list": "EVERYONE",
      "htpr-7755-bulk-preview-confirmation": "EVERYONE",
      "yper4-651-self-follow-quiet": "EVERYONE",
    },
  }));
  fs.writeFileSync(sinceFile, JSON.stringify({
    "htpr-3533-google-calendar": "2026-10-16T00:00:00.000Z",
    "htpr-7324-plan-ai-caps": "2026-10-09T00:00:00.000Z",
    "htpr-7350-card-title-wrap": "2026-09-01T00:00:00.000Z",
    "htpr-7702-phone-chat-list": "2026-10-16T00:00:00.000Z",
    "htpr-7755-bulk-preview-confirmation": "2026-10-16T00:00:00.000Z",
    "yper4-651-self-follow-quiet": "2026-10-16T00:00:00.000Z",
  }));
  const run = (extra) => spawnSync(process.execPath, [
    script, "--snapshot", snapshot, "--since", sinceFile, "--now", now, ...extra,
  ], { cwd: root, encoding: "utf8" });
  const first = run([]);
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.equal(report.dryRun, true);
  assert.equal(report.filesTickets, false);
  assert.equal(report.switchesMode, false);
  assert.equal(report.filed, 0);
  assert.equal(report.deferred, 0);
  assert.equal(report.ticketsPerRun, 10);
  assert.deepEqual(report.missingSince, ["htpr-7308-phone-layout-width"]);
  assert.deepEqual(report.wouldFile.map((item) => [item.key, item.windowDays]), [
    ["htpr-7324-plan-ai-caps", 14],
    ["htpr-7702-phone-chat-list", 7],
    ["yper4-651-self-follow-quiet", 7],
  ]);
  fs.writeFileSync(firstFile, first.stdout);
  const second = run(["--already", firstFile]);
  assert.equal(second.status, 0, second.stderr);
  const again = JSON.parse(second.stdout);
  assert.deepEqual(again.wouldFile, []);
  assert.equal(again.newTickets, 0);
  assert.equal(again.deferred, 0);
  assert.equal(again.filed, 0);
  assert.deepEqual(again.alreadyRecorded.map((item) => item.key), report.wouldFile.map((item) => item.key));
});

test("44 eligible flags would file the 10 oldest and leave the rest for the next run", async () => {
  const { removalCandidates } = await import("../scripts/flags/flag-removal-candidates.mjs");
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const definitions = Array.from({ length: 44 }, (_, index) => ({
    key: `flag-${String(index).padStart(2, "0")}`,
    kind: "bugfix",
  }));
  const modes = Object.fromEntries(definitions.map((definition) => [definition.key, "EVERYONE"]));
  const since = Object.fromEntries(definitions.map((definition, index) => [
    definition.key,
    new Date(start + index * 60 * 60 * 1000).toISOString(),
  ]));
  const now = new Date("2026-10-24T00:00:00.000Z");
  const first = removalCandidates({ definitions, modes, since, now });
  const oldest = definitions.slice(0, 10).map((definition) => definition.key);
  assert.deepEqual(first.wouldFile.map((item) => item.key), oldest);
  assert.equal(first.deferred, 34);
  assert.equal(first.filed, 0);
  assert.equal(first.filesTickets, false);
  assert.equal(first.switchesMode, false);
  const second = removalCandidates({
    definitions,
    modes,
    since,
    now,
    already: oldest,
  });
  assert.deepEqual(second.wouldFile.map((item) => item.key), definitions.slice(10, 20).map((definition) => definition.key));
  assert.equal(second.deferred, 24);
  assert.equal(second.wouldFile.some((item) => oldest.includes(item.key)), false);
});

test("the candidate command refuses to file tickets", () => {
  const result = spawnSync(process.execPath, [script, "--file"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /never files tickets/);
});
