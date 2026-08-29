const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const jitiModule = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = jitiModule.createJiti
  ? jitiModule.createJiti(__filename, {
      interopDefault: true,
      moduleCache: false,
    })
  : jitiModule(__filename, { interopDefault: true, cache: false });
const {
  clearCalendarSessionDraft,
  readCalendarSessionDraft,
  resolveCalendarSessionDraft,
  writeCalendarSessionDraft,
} = jiti(path.join(root, "src/lib/calendarSessionDraft.ts"));

const state = {
  checkedProjects: [15, 42],
  taskFilters: {
    assignedToMe: false,
    updatedBy: [],
    createdBy: [],
    priority: [],
    assignees: [],
    assigneeAgents: [],
    updatedByAgents: [],
    labels: [],
    size: [],
    matchFilters: "ANY",
  },
  settings: { weekStartsOn: "monday", showWeekends: false, view: "week" },
  sort: null,
};

const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
};

test("restores an unsaved Calendar state only for the same account and view", () => {
  const session = storage();
  writeCalendarSessionDraft(session, 6, { appliedViewId: null, state });

  const draft = readCalendarSessionDraft(session, 6);
  assert.deepEqual(resolveCalendarSessionDraft(draft, null), state);
  assert.equal(resolveCalendarSessionDraft(draft, "saved-view"), null);
  assert.equal(readCalendarSessionDraft(session, 7), null);
});

test("clears a session draft once Calendar returns to its saved state", () => {
  const session = storage();
  writeCalendarSessionDraft(session, 6, { appliedViewId: null, state });
  clearCalendarSessionDraft(session, 6);
  assert.equal(readCalendarSessionDraft(session, 6), null);
});

test("rejects and removes malformed Calendar session state", () => {
  const session = storage();
  session.setItem(
    "hypertask:calendar-session-draft:6",
    JSON.stringify({ appliedViewId: null, state: { checkedProjects: [15] } }),
  );
  assert.equal(readCalendarSessionDraft(session, 6), null);
  assert.equal(session.values.size, 0);
});

// HTPR-5391 follow-up: the URL-sync effect writes view/date into the address
// bar on every render, so treating their presence as prior user interaction
// skipped the draft restore on exactly the return path the ticket is about.
// The deep link must be re-applied after hydration instead of suppressing it.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const hookSource = fs.readFileSync(
    path.resolve(__dirname, "../src/hooks/Calendar/useCalendarView.ts"),
    "utf8",
  );

  test("a URL deep link does not suppress session-draft hydration", () => {
    const mountEffect = hookSource.slice(
      hookSource.indexOf("Shareable URLs:"),
      hookSource.indexOf("Keep the address bar current"),
    );
    assert.ok(mountEffect.length > 0);
    assert.doesNotMatch(
      mountEffect,
      /hasInteractedWithCalendarState\.current = true/,
    );
    assert.match(mountEffect, /urlDeepLinkRef\.current\.view = view/);
    assert.match(mountEffect, /urlDeepLinkRef\.current\.date = parsed/);
  });

  test("the deep link is re-applied after a draft or saved view lands", () => {
    assert.match(
      hookSource,
      /applyCalendarViewState\(sessionDraft\);\s*\n\s*restoreUrlDeepLink\(\);/,
    );
  });

  // The mount effect calls setCurrentView for a deep link. Without a
  // re-baseline that render differs from the captured initial state, which the
  // comparison effect reads as "the user already changed something" and uses to
  // skip hydration entirely.
  test("only a URL view change arms the re-baseline", () => {
    // The baseline JSON contains currentView but not currentDate, so a
    // date-only link never fires the comparison effect. Arming the flag for it
    // would leave it set and swallow the user's next real change.
    assert.match(hookSource, /viewChangeQueued = true;/);
    assert.match(
      hookSource,
      /if \(viewChangeQueued\) \{\s*\n\s*urlBaselineSyncPending\.current = true;/,
    );
  });

  test("URL-applied state re-baselines instead of counting as interaction", () => {
    assert.match(hookSource, /urlBaselineSyncPending\.current = true;/);
    assert.match(
      hookSource,
      /urlBaselineSyncPending\.current = false;\s*\n\s*initialCalendarViewState\.current = nextState;/,
    );
  });
}
