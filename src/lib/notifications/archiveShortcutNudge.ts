export const ARCHIVE_SHORTCUT_NUDGE_THRESHOLD = 3;
export const ARCHIVE_SHORTCUT_NUDGE_DURATION_MS = 8_000;

export type ArchiveShortcutSource = "keyboard" | "mouse" | "swipe";
export type ArchiveShortcutNudgeStage = "counting" | "pending" | "showing";

export type ArchiveShortcutNudgeState = {
  accountId: number | null;
  mouseArchives: number;
  stage: ArchiveShortcutNudgeStage;
  hideAt: number | null;
};

export const EMPTY_ARCHIVE_SHORTCUT_NUDGE: ArchiveShortcutNudgeState = {
  accountId: null,
  mouseArchives: 0,
  stage: "counting",
  hideAt: null,
};

export function clearArchiveShortcutNudge(
  state: ArchiveShortcutNudgeState,
  accountId: number | null,
): ArchiveShortcutNudgeState {
  if (
    state.accountId === accountId &&
    state.mouseArchives === 0 &&
    state.stage === "counting" &&
    state.hideAt === null
  ) {
    return state;
  }
  return { ...EMPTY_ARCHIVE_SHORTCUT_NUDGE, accountId };
}
export function recordArchiveShortcutAction(
  state: ArchiveShortcutNudgeState,
  input: {
    accountId: number;
    source: ArchiveShortcutSource;
    succeeded: boolean;
    enabled: boolean;
  },
): ArchiveShortcutNudgeState {
  const current =
    state.accountId === input.accountId
      ? state
      : { ...EMPTY_ARCHIVE_SHORTCUT_NUDGE, accountId: input.accountId };

  if (!input.enabled || input.source === "keyboard") {
    return clearArchiveShortcutNudge(current, input.accountId);
  }
  if (!input.succeeded || input.source === "swipe") return current;
  if (current.stage !== "counting") return current;

  const mouseArchives = current.mouseArchives + 1;
  if (mouseArchives < ARCHIVE_SHORTCUT_NUDGE_THRESHOLD) {
    return { ...current, mouseArchives };
  }
  return { ...current, mouseArchives: 0, stage: "pending" };
}

export function isTaskDetailPath(pathname: string | null): boolean {
  return pathname === "/detail" || Boolean(pathname?.startsWith("/detail/"));
}

export function beginArchiveShortcutNudge(
  state: ArchiveShortcutNudgeState,
  accountId: number,
  now: number,
): ArchiveShortcutNudgeState {
  if (state.accountId !== accountId || state.stage !== "pending") return state;
  return {
    ...state,
    stage: "showing",
    hideAt: now + ARCHIVE_SHORTCUT_NUDGE_DURATION_MS,
  };
}
