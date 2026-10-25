import assert from "node:assert/strict";
import test from "node:test";
import {
  BUGFIX_FLAG_REMOVAL_DAYS,
  FEATURE_FLAG_REMOVAL_DAYS,
  featureFlagRemovalDueAt,
  featureFlagRemovalState,
} from "../src/lib/flags/removal";
import type { FeatureFlagRow } from "../src/lib/flags";

const NOW = new Date("2026-09-20T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function row(overrides: Partial<FeatureFlagRow> & { highRisk?: string | null }): FeatureFlagRow & { highRisk?: string | null } {
  return {
    key: "htpr-1-some-flag",
    kind: "feature",
    mode: "EVERYONE",
    updatedAt: null,
    releasedAt: null,
    keep: false,
    removalTaskId: null,
    shippedOn: null,
    description: "",
    ticketId: null,
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

test("the sweep's in-flight claim still shows the countdown, not a filed ticket", () => {
  // The sweep writes 0 to claim a flag for the seconds it takes to create the ticket. Reading
  // that as "filed" would tell the owner a ticket exists before one does.
  const claimed = row({ releasedAt: daysBefore(30), removalTaskId: 0 });
  assert.deepEqual(featureFlagRemovalState(claimed, NOW), { kind: "due", label: "due for removal" });
});

test("a filed removal ticket ends the countdown, even if Keep is pressed afterwards", () => {
  const overdue = { releasedAt: daysBefore(30), removalTaskId: 4242 };
  assert.deepEqual(featureFlagRemovalState(row(overdue), NOW), {
    kind: "filed",
    label: "removal ticket filed",
  });
  assert.equal(featureFlagRemovalState(row({ ...overdue, keep: true }), NOW)?.kind, "filed");
});

test("a bugfix flag is due after 7 days and a money, access or data-deletion flag stays at 14", () => {
  assert.equal(BUGFIX_FLAG_REMOVAL_DAYS, 7);
  assert.equal(featureFlagRemovalState(row({ kind: "bugfix", releasedAt: NOW }), NOW)?.label, "removed in 7 days");
  assert.equal(featureFlagRemovalState(row({ kind: "bugfix", releasedAt: daysBefore(6) }), NOW)?.label, "removed in 1 day");
  assert.deepEqual(featureFlagRemovalState(row({ kind: "bugfix", releasedAt: daysBefore(7) }), NOW), {
    kind: "due",
    label: "due for removal",
  });
  for (const highRisk of ["money", "access", "data-deletion"] as const) {
    assert.equal(
      featureFlagRemovalState(row({ kind: "bugfix", highRisk, releasedAt: daysBefore(7) }), NOW)?.label,
      "removed in 7 days",
    );
    assert.equal(featureFlagRemovalState(row({ kind: "bugfix", highRisk, releasedAt: daysBefore(14) }), NOW)?.kind, "due");
  }
  assert.equal(
    featureFlagRemovalState(row({ kind: "bugfix", highRisk: "customer-email", releasedAt: daysBefore(7) }), NOW)?.kind,
    "due",
  );
  assert.equal(featureFlagRemovalDueAt({
    mode: "EVERYONE",
    kind: "bugfix",
    releasedAt: daysBefore(1),
  })?.getTime(), daysBefore(1).getTime() + BUGFIX_FLAG_REMOVAL_DAYS * DAY_MS);
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
