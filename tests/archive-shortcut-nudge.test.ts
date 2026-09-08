import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_SHORTCUT_NUDGE_DURATION_MS,
  EMPTY_ARCHIVE_SHORTCUT_NUDGE,
  beginArchiveShortcutNudge,
  clearArchiveShortcutNudge,
  isTaskDetailPath,
  recordArchiveShortcutAction,
  type ArchiveShortcutNudgeState,
} from "../src/lib/notifications/archiveShortcutNudge";

const archive = (
  state: ArchiveShortcutNudgeState,
  source: "keyboard" | "mouse" | "swipe" = "mouse",
  succeeded = true,
  enabled = true,
  accountId = 6,
) =>
  recordArchiveShortcutAction(state, {
    accountId,
    source,
    succeeded,
    enabled,
  });

test("three confirmed mouse archives queue one nudge", () => {
  let state = archive(archive(EMPTY_ARCHIVE_SHORTCUT_NUDGE));
  assert.equal(state.mouseArchives, 2);
  assert.equal(archive(state, "mouse", false).mouseArchives, 2);
  state = archive(state);
  assert.equal(state.stage, "pending");
  assert.equal(state.mouseArchives, 0);
  assert.equal(archive(state), state, "a pending nudge is not duplicated");
});

test("keyboard clears the whole lifecycle while swipe is neutral", () => {
  let state = archive(archive(EMPTY_ARCHIVE_SHORTCUT_NUDGE));
  assert.equal(archive(state, "swipe"), state);
  state = archive(state);
  state = beginArchiveShortcutNudge(state, 6, 1_000);
  assert.equal(state.stage, "showing");
  assert.equal(state.hideAt, 1_000 + ARCHIVE_SHORTCUT_NUDGE_DURATION_MS);
  assert.deepEqual(archive(state, "keyboard"), clearArchiveShortcutNudge(state, 6));
});

test("opt-out and account changes discard stale progress", () => {
  const state = archive(archive(EMPTY_ARCHIVE_SHORTCUT_NUDGE));
  assert.deepEqual(archive(state, "mouse", true, false), clearArchiveShortcutNudge(state, 6));
  const nextAccount = archive(state, "mouse", true, true, 7);
  assert.equal(nextAccount.accountId, 7);
  assert.equal(nextAccount.mouseArchives, 1);
});

test("only task-detail routes are eligible", () => {
  assert.equal(isTaskDetailPath("/detail/project-15/5906"), true);
  assert.equal(isTaskDetailPath("/detail"), true);
  assert.equal(isTaskDetailPath("/details/project-15/5906"), false);
  assert.equal(isTaskDetailPath("/inbox"), false);
  assert.equal(isTaskDetailPath(null), false);
});
