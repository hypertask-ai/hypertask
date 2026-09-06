import assert from "node:assert/strict";
import test from "node:test";
import {
  FEATURE_FLAG_REMOVAL_DAYS,
  featureFlagRemovalDueAt,
  featureFlagRemovalState,
} from "../src/lib/flags/removal";
import type { FeatureFlagRow } from "../src/lib/flags";

const NOW = new Date("2026-09-20T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: Partial<FeatureFlagRow>): FeatureFlagRow {
  return {
    key: "htpr-1-some-flag",
    mode: "EVERYONE",
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

const daysBefore = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

test("only an Everyone flag with a release date counts down", () => {
  assert.equal(featureFlagRemovalState(row({ releasedAt: null }), NOW), null);
  for (const mode of ["OWNER_ONLY", "OWNER_AND_QA", "OFF"] as const) {
    assert.equal(featureFlagRemovalState(row({ mode, releasedAt: daysBefore(1) }), NOW), null);
  }
});

test("a flag switched to Everyone today has the full window left", () => {
  const state = featureFlagRemovalState(row({ releasedAt: NOW }), NOW);
  assert.deepEqual(state, {
    kind: "counting",
    days: FEATURE_FLAG_REMOVAL_DAYS,
    label: `removed in ${FEATURE_FLAG_REMOVAL_DAYS} days`,
  });
});

test("the countdown reads whole days and switches to due only after the deadline passes", () => {
  assert.equal(featureFlagRemovalState(row({ releasedAt: daysBefore(5) }), NOW)?.label, "removed in 9 days");
  assert.equal(featureFlagRemovalState(row({ releasedAt: daysBefore(13) }), NOW)?.label, "removed in 1 day");
  // One second before the deadline is still counting, not due.
  const nearlyDue = new Date(NOW.getTime() - FEATURE_FLAG_REMOVAL_DAYS * DAY_MS + 1000);
  assert.equal(featureFlagRemovalState(row({ releasedAt: nearlyDue }), NOW)?.kind, "counting");
  assert.deepEqual(featureFlagRemovalState(row({ releasedAt: daysBefore(FEATURE_FLAG_REMOVAL_DAYS) }), NOW), {
    kind: "due",
    label: "due for removal",
  });
});

test("Keep replaces the countdown and resumes it from the original date when turned off", () => {
  const releasedAt = daysBefore(5);
  assert.deepEqual(featureFlagRemovalState(row({ releasedAt, keep: true }), NOW), {
    kind: "kept",
    label: "kept",
  });
  assert.equal(featureFlagRemovalState(row({ releasedAt, keep: false }), NOW)?.label, "removed in 9 days");
});

test("a filed removal ticket ends the countdown, even if Keep is pressed afterwards", () => {
  const overdue = { releasedAt: daysBefore(30), removalTaskId: 4242 };
  assert.deepEqual(featureFlagRemovalState(row(overdue), NOW), {
    kind: "filed",
    label: "removal ticket filed",
  });
  assert.equal(featureFlagRemovalState(row({ ...overdue, keep: true }), NOW)?.kind, "filed");
});

test("the due date is the release date plus the removal window, and null without one", () => {
  const releasedAt = daysBefore(1);
  assert.equal(
    featureFlagRemovalDueAt({ mode: "EVERYONE", releasedAt })?.getTime(),
    releasedAt.getTime() + FEATURE_FLAG_REMOVAL_DAYS * DAY_MS,
  );
  assert.equal(featureFlagRemovalDueAt({ mode: "EVERYONE", releasedAt: "not a date" }), null);
  assert.equal(featureFlagRemovalDueAt({ mode: "OFF", releasedAt }), null);
});
