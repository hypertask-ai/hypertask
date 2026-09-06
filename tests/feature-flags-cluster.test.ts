import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterFeatureFlagsByReleaseDate,
  NOT_YET_RELEASED_LABEL,
} from "../src/lib/flags/cluster";
import type { FeatureFlagRow } from "../src/lib/flags";

function row(overrides: Partial<FeatureFlagRow>): FeatureFlagRow {
  return {
    key: "some-flag",
    mode: "OWNER_ONLY",
    updatedAt: null,
    releasedAt: null,
    keep: false,
    removalTaskId: null,
    shippedOn: null,
    description: "",
    ticketUrl: null,
    ticketTitle: null,
    ...overrides,
  };
}

test("clusters flags by calendar day, newest first by default", () => {
  const older = row({ key: "old", updatedAt: new Date("2026-01-01T10:00:00Z") });
  const newer = row({ key: "new", updatedAt: new Date("2026-02-01T10:00:00Z") });
  const sameDay = row({ key: "same-day", updatedAt: new Date("2026-02-01T18:00:00Z") });

  const clusters = clusterFeatureFlagsByReleaseDate([older, newer, sameDay], "desc", "ALL");

  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters[0][1].map((f) => f.key).sort(),
    ["new", "same-day"],
  );
  assert.deepEqual(clusters[1][1].map((f) => f.key), ["old"]);
});

test("never-touched flags land in a trailing Not yet released cluster in both directions", () => {
  const untouched = row({ key: "untouched", updatedAt: null });
  const touched = row({ key: "touched", updatedAt: new Date("2026-01-01T00:00:00Z") });

  for (const direction of ["desc", "asc"] as const) {
    const clusters = clusterFeatureFlagsByReleaseDate([untouched, touched], direction, "ALL");
    const labels = clusters.map(([label]) => label);
    assert.equal(labels[labels.length - 1], NOT_YET_RELEASED_LABEL);
  }
});

test("audience filter narrows rows before clustering", () => {
  const ownerOnly = row({ key: "owner", mode: "OWNER_ONLY", updatedAt: new Date("2026-01-01T00:00:00Z") });
  const everyone = row({ key: "everyone", mode: "EVERYONE", updatedAt: new Date("2026-01-01T00:00:00Z") });

  const clusters = clusterFeatureFlagsByReleaseDate([ownerOnly, everyone], "desc", "EVERYONE");

  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0][1].map((f) => f.key), ["everyone"]);
});

test("ship-date mode groups on the day the flag reached production, not the last mode change", () => {
  const early = row({
    key: "shipped-first",
    shippedOn: "2026-09-04",
    updatedAt: new Date("2026-09-05T12:00:00Z"),
  });
  const late = row({
    key: "shipped-second",
    shippedOn: "2026-09-05",
    updatedAt: new Date("2026-09-04T12:00:00Z"),
  });

  const clusters = clusterFeatureFlagsByReleaseDate([early, late], "desc", "ALL", true);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0][1].map((f) => f.key), ["shipped-second"]);
  assert.deepEqual(clusters[1][1].map((f) => f.key), ["shipped-first"]);
});

test("ship-date mode has no Not yet released cluster for a flag no one has touched", () => {
  const untouched = row({ key: "untouched", shippedOn: "2026-09-04", updatedAt: null });

  const clusters = clusterFeatureFlagsByReleaseDate([untouched], "desc", "ALL", true);

  assert.equal(clusters.length, 1);
  assert.notEqual(clusters[0][0], NOT_YET_RELEASED_LABEL);
});

test("ship-date labels use the local calendar day, not UTC midnight", () => {
  const flag = row({ key: "shipped", shippedOn: "2026-09-04" });
  const expected = new Date(2026, 8, 4).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const clusters = clusterFeatureFlagsByReleaseDate([flag], "desc", "ALL", true);

  assert.equal(clusters[0][0], expected);
});

test("ship-date mode falls back to the mode-change date for a stored key with no definition", () => {
  const legacy = row({ key: "legacy", shippedOn: null, updatedAt: new Date("2026-09-03T09:00:00Z") });
  const declared = row({ key: "declared", shippedOn: "2026-09-05" });

  const clusters = clusterFeatureFlagsByReleaseDate([legacy, declared], "desc", "ALL", true);

  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters[0][1].map((f) => f.key), ["declared"]);
  assert.deepEqual(clusters[1][1].map((f) => f.key), ["legacy"]);
  assert.equal(clusters.some(([label]) => label === NOT_YET_RELEASED_LABEL), false);
});

test("ship-date headings follow the sort direction", () => {
  const older = row({ key: "older", shippedOn: "2026-09-04" });
  const newer = row({ key: "newer", shippedOn: "2026-09-05" });

  const desc = clusterFeatureFlagsByReleaseDate([older, newer], "desc", "ALL", true);
  const asc = clusterFeatureFlagsByReleaseDate([older, newer], "asc", "ALL", true);

  assert.deepEqual(desc[0][1].map((f) => f.key), ["newer"]);
  assert.deepEqual(asc[0][1].map((f) => f.key), ["older"]);
});
