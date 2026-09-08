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

const mouseArchive = (
  state: ArchiveShortcutNudgeState,
  succeeded = true,
) =>
  recordArchiveShortcutAction(state, {
    accountId: 6,
    source: "mouse",
    succeeded,
    enabled: true,
  });

test("three confirmed mouse archives queue one nudge", () => {
  let state = EMPTY_ARCHIVE_SHORTCUT_NUDGE;
  state = mouseArchive(state);
  state = mouseArchive(state);
  assert.deepEqual(state, {
    accountId: 6,
    mouseArchives: 2,
    stage: "counting",
    hideAt: null,
  });

  state = mouseArchive(state, false);
  assert.equal(state.mouseArchives, 2);
  state = mouseArchive(state);
  assert.equal(state.stage, "pending");
  assert.equal(state.mouseArchives, 0);

  assert.equal(mouseArchive(state), state, "a pending nudge is not duplicated");
});

test("keyboard clears the whole lifecycle while swipe is neutral", () => {
  let state = mouseArchive(mouseArchive(EMPTY_ARCHIVE_SHORTCUT_NUDGE));
  assert.equal(
    recordArchiveShortcutAction(state, {
      accountId: 6,
      source: "swipe",
      succeeded: true,
      enabled: true,
    }),
    state,
  );

  state = mouseArchive(state);
  state = beginArchiveShortcutNudge(state, 6, 1_000);
  assert.equal(state.stage, "showing");
  assert.equal(state.hideAt, 1_000 + ARCHIVE_SHORTCUT_NUDGE_DURATION_MS);

  state = recordArchiveShortcutAction(state, {
    accountId: 6,
    source: "keyboard",
    succeeded: true,
    enabled: true,
  });
  assert.deepEqual(state, {
    accountId: 6,
    mouseArchives: 0,
    stage: "counting",
    hideAt: null,
  });
});

test("opt-out and account changes discard stale progress", () => {
  const state = mouseArchive(mouseArchive(EMPTY_ARCHIVE_SHORTCUT_NUDGE));
  assert.deepEqual(
    recordArchiveShortcutAction(state, {
      accountId: 6,
      source: "mouse",
      succeeded: true,
      enabled: false,
    }),
    clearArchiveShortcutNudge(state, 6),
  );

  const nextAccount = recordArchiveShortcutAction(state, {
    accountId: 7,
    source: "mouse",
    succeeded: true,
    enabled: true,
  });
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
