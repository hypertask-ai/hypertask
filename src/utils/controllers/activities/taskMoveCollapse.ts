import type { ITaskMoveActivity } from "@/models/ActivityModels.ts";

export const STATUS_FLIP_COLLAPSE_WINDOW_MS = 30 * 60 * 1000;
export const QUICK_MOVE_COLLAPSE_WINDOW_MS = 60_000;

export type TaskMoveCollapseKind = "status-flip" | "quick-journey" | null;

type MoveActivity = {
  type?: string;
  data?: {
    fromSection?: { sectionId?: number | null; sectionTitle?: string };
    toSection?: { sectionId?: number | null; sectionTitle?: string };
    currentSection?: { sectionId?: number | null; sectionTitle?: string };
    fromAgent?: { id?: string } | null;
    fromUserId?: number;
    quickMoveCollapsed?: boolean;
    statusFlipCount?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function classifyTaskMoveCollapse({
  previousActivity,
  previousCreatedAt,
  sameActor,
  fromSectionId,
  toSectionId,
  now = Date.now(),
}: {
  previousActivity: MoveActivity | null | undefined;
  previousCreatedAt: Date | string | number;
  sameActor: boolean;
  fromSectionId: number | null;
  toSectionId: number | null;
  now?: number;
}): TaskMoveCollapseKind {
  if (previousActivity?.type !== "TaskMove" || !sameActor) return null;

  const age = now - new Date(previousCreatedAt).getTime();
  if (age < 0) return null;

  const data = previousActivity.data;
  const previousFromId = data?.fromSection?.sectionId;
  const previousToId = data?.toSection?.sectionId;
  const previousCurrentId = data?.currentSection?.sectionId ?? previousToId;
  if (previousCurrentId !== fromSectionId) return null;

  const samePair =
    (previousFromId === fromSectionId && previousToId === toSectionId) ||
    (previousFromId === toSectionId && previousToId === fromSectionId);
  if (
    samePair &&
    !data?.quickMoveCollapsed &&
    age <= STATUS_FLIP_COLLAPSE_WINDOW_MS
  ) {
    return "status-flip";
  }

  if (
    !data?.statusFlipCount &&
    previousToId === fromSectionId &&
    age <= QUICK_MOVE_COLLAPSE_WINDOW_MS
  ) {
    return "quick-journey";
  }

  return null;
}

export function mergeStatusFlipActivity(
  previousActivity: ITaskMoveActivity,
  currentSection: { sectionId: number | null; sectionTitle: string },
): ITaskMoveActivity {
  const previousCount = Number(previousActivity.data?.statusFlipCount) || 0;
  return {
    ...previousActivity,
    data: {
      ...previousActivity.data,
      currentSection,
      statusFlipCount: previousCount + 1,
    },
  };
}
