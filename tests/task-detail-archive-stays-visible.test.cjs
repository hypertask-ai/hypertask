// HTPR-5480: archiving from the task detail page must show the archived state
// immediately when the page does not navigate away.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { createJiti } = require("jiti");
const jiti = createJiti(__filename, { interopDefault: true });
const {
  nextRemainingInboxTask,
  resolveTaskPlaylistNavigation,
  shouldAdvanceAfterNotificationArchive,
  shouldApplyLocalArchivedStatus,
} = jiti(path.join(root, "src/lib/taskDetailArchiveNavigation.ts"));

test("notification archive advances only from the inbox flow", () => {
  assert.equal(shouldAdvanceAfterNotificationArchive("true"), true);
  assert.equal(shouldAdvanceAfterNotificationArchive(null), false);
  assert.equal(shouldAdvanceAfterNotificationArchive(undefined), false);
  assert.equal(shouldAdvanceAfterNotificationArchive("false"), false);
});

test("the task-detail E shortcut uses the inbox-flow navigation decision", () => {
  const taskDetail = fs.readFileSync(
    path.join(root, "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8",
  );
  const shortcutStart = taskDetail.indexOf("// press [e]");
  const shortcutEnd = taskDetail.indexOf("// press [j]", shortcutStart);
  const shortcut = taskDetail.slice(shortcutStart, shortcutEnd);

  assert.ok(shortcutStart >= 0 && shortcutEnd > shortcutStart);
  assert.match(shortcut, /shouldAdvanceAfterNotificationArchive\(inboxFlow\)/);
  assert.doesNotMatch(shortcut, /navigateToNextTask\(true, true\)/);
});

test("playlist navigation keeps the existing next/back behaviour", () => {
  // Middle of the playlist: open the following task.
  assert.equal(
    resolveTaskPlaylistNavigation({ indexOf: 0, playlistLength: 3 }),
    "next",
  );
  // Last task, or the only task: leave the detail page.
  assert.equal(
    resolveTaskPlaylistNavigation({ indexOf: 2, playlistLength: 3 }),
    "back",
  );
  assert.equal(
    resolveTaskPlaylistNavigation({ indexOf: 0, playlistLength: 1 }),
    "back",
  );
  // No playlist at all: leave the now-stale detail page.
  assert.equal(
    resolveTaskPlaylistNavigation({ indexOf: -1, playlistLength: 0 }),
    "back",
  );
  // A snooze always leaves the page, even when the playlist cannot place it.
  assert.equal(
    resolveTaskPlaylistNavigation({
      indexOf: -1,
      playlistLength: 3,
      remindMe: true,
    }),
    "back",
  );
});

test("a task missing from a non-empty playlist keeps the detail page open", () => {
  assert.equal(
    resolveTaskPlaylistNavigation({ indexOf: -1, playlistLength: 3 }),
    "stay",
  );
});

test("inbox archive advances when the current task is already absent from the playlist", () => {
  assert.equal(
    resolveTaskPlaylistNavigation({
      indexOf: -1,
      playlistLength: 3,
      inboxFlow: true,
      hasNextInboxTask: true,
    }),
    "next",
  );
});

test("inbox archive exits instead of reopening the final task", () => {
  const currentTask = { projectId: 15, uniqueIndex: 5584 };
  assert.equal(nextRemainingInboxTask([currentTask], currentTask), undefined);
  assert.equal(
    resolveTaskPlaylistNavigation({
      indexOf: -1,
      playlistLength: 1,
      inboxFlow: true,
      hasNextInboxTask: false,
    }),
    "back",
  );
});

test("inbox archive skips the archived task when choosing a remaining target", () => {
  const currentTask = { projectId: 15, uniqueIndex: 5584 };
  const nextTask = { projectId: 15, uniqueIndex: 5585 };
  assert.deepEqual(
    nextRemainingInboxTask([currentTask, nextTask], currentTask),
    nextTask,
  );
});

test("inbox archive preserves order when playlist identifiers use strings", () => {
  const previousTask = { projectId: 15, uniqueIndex: 5583 };
  const currentTask = { projectId: 15, uniqueIndex: 5584 };
  const nextTask = { projectId: 15, uniqueIndex: 5585 };
  assert.deepEqual(
    nextRemainingInboxTask(
      [previousTask, { projectId: "15", uniqueIndex: "5584" }, nextTask],
      currentTask,
    ),
    nextTask,
  );
});

test("staying on the page applies the archived status immediately", () => {
  assert.equal(
    shouldApplyLocalArchivedStatus({
      isUnarchiving: false,
      navigationOutcome: "stayed",
    }),
    true,
  );
});

test("navigating away never flashes the archived state on the way out", () => {
  assert.equal(
    shouldApplyLocalArchivedStatus({
      isUnarchiving: false,
      navigationOutcome: "navigated",
    }),
    false,
  );
});

test("unarchiving keeps its own status update and is not overridden", () => {
  assert.equal(
    shouldApplyLocalArchivedStatus({
      isUnarchiving: true,
      navigationOutcome: "stayed",
    }),
    false,
  );
  assert.equal(
    shouldApplyLocalArchivedStatus({
      isUnarchiving: true,
      navigationOutcome: "navigated",
    }),
    false,
  );
});

test("the archive hook reports whether it navigated", () => {
  const hook = fs.readFileSync(
    path.join(root, "src/hooks/Task Detail/useArchiveAndNavigate.ts"),
    "utf8",
  );
  assert.match(hook, /resolveTaskPlaylistNavigation/);
  assert.match(hook, /inboxFlow: Boolean\(activeInboxFlow\)/);
  assert.match(hook, /nextRemainingInboxTask/);
  assert.match(hook, /const navigationOutcome = navigateToNextTask\(/);
  assert.match(hook, /return "navigated"/);
  assert.match(hook, /return "stayed"/);
});
