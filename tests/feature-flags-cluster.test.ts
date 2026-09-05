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
