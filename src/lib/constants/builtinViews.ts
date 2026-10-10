import type { IProject, ITask, IView } from "@/models/model";
import { doneColumnTitles, isDoneColumn } from "@/lib/doneColumns";
import { resolveCycleWindow } from "@/lib/cycles";

export const BUILTIN_VIEW_IDS = {
  myTasks: "builtin:my-tasks",
  overdue: "builtin:overdue",
  blocked: "builtin:blocked",
  agents: "builtin:agents",
  currentCycle: "builtin:current-cycle",
  nextCycle: "builtin:next-cycle",
  decisions: "builtin:decisions",
} as const;

export type BuiltinViewId =
  (typeof BUILTIN_VIEW_IDS)[keyof typeof BUILTIN_VIEW_IDS];

export interface BuiltinViewContext {
  currentUserId?: number | null;
  now?: Date | number;
  doneSectionTitles?: ReadonlySet<string>;
  currentCycleId?: number | null;
  nextCycleId?: number | null;
  cyclesEnabled?: boolean;
  /** Names the current user's "<name> Review" column can carry (HTPR-7092). */
  currentUserNames?: string[];
}

export interface BuiltinView {
  id: BuiltinViewId;
  title: string;
  builtin: true;
  predicate: (task: ITask, context: BuiltinViewContext) => boolean;
  /** When set, columns failing it are dropped from the board while this view is active. */
  sectionPredicate?: (sectionTitle: string, context: BuiltinViewContext) => boolean;
  /** Drop columns left with no tickets by the predicate. */
  hideEmptySections?: boolean;
  available?: (context: BuiltinViewContext) => boolean;
}

export type BoardView = IView | BuiltinView;

const isPastDate = (value: Date, now: Date | number | undefined) => {
  const timestamp = new Date(value).getTime();
  const nowTimestamp = now instanceof Date ? now.getTime() : now ?? Date.now();
  return Number.isFinite(timestamp) && timestamp < nowTimestamp;
};

export const myTasksPredicate: BuiltinView["predicate"] = (task, context) =>
  context.currentUserId != null &&
  (task.assignees ?? []).some(
    (assignee) =>
      assignee.userId === context.currentUserId &&
      (assignee.agentId === null || assignee.agentId === undefined),
  );

export const overduePredicate: BuiltinView["predicate"] = (task, context) =>
  task.status === "Normal" &&
  task.dueDate != null &&
  isPastDate(task.dueDate, context.now) &&
  !isDoneColumn(task.section, context.doneSectionTitles);

export const blockedPredicate: BuiltinView["predicate"] = (task) =>
  task.waitingOnUserId != null || (task.blockingTasks?.length ?? 0) > 0;

export const agentsPredicate: BuiltinView["predicate"] = (task) =>
  (task.assignees ?? []).some((assignee) => assignee.agentId != null);

export const currentCyclePredicate: BuiltinView["predicate"] = (task, context) =>
  context.currentCycleId != null && task.cycleId === context.currentCycleId;

export const nextCyclePredicate: BuiltinView["predicate"] = (task, context) =>
  context.nextCycleId != null && task.cycleId === context.nextCycleId;

export const UX_SIGN_OFF_COLUMN = "UX Sign-off";

// HTPR-7092: the columns where a ticket waits on this person's yes or no: their own
// "<name> Review" column (full or first name, as the review lanes are named) and UX Sign-off.
export const decisionsSectionPredicate: NonNullable<BuiltinView["sectionPredicate"]> = (
  sectionTitle,
  context,
) => {
  const title = sectionTitle.trim().toLowerCase();
  if (title === UX_SIGN_OFF_COLUMN.toLowerCase()) return true;
  return (context.currentUserNames ?? []).some(
    (name) => name.trim() !== "" && title === `${name.trim().toLowerCase()} review`,
  );
};

export const decisionsPredicate: BuiltinView["predicate"] = (task, context) =>
  decisionsSectionPredicate(task.section ?? "", context);

export const BUILTIN_VIEWS: readonly BuiltinView[] = [
  {
    id: BUILTIN_VIEW_IDS.myTasks,
    title: "My Tasks",
    builtin: true,
    predicate: myTasksPredicate,
  },
  {
    id: BUILTIN_VIEW_IDS.overdue,
    title: "Overdue",
    builtin: true,
    predicate: overduePredicate,
  },
  {
    id: BUILTIN_VIEW_IDS.blocked,
    title: "Blocked",
    builtin: true,
    predicate: blockedPredicate,
  },
  {
    id: BUILTIN_VIEW_IDS.agents,
    title: "Agents",
    builtin: true,
    predicate: agentsPredicate,
  },
  {
    id: BUILTIN_VIEW_IDS.currentCycle,
    title: "Current cycle",
    builtin: true,
    predicate: currentCyclePredicate,
    available: (context) => Boolean(context.cyclesEnabled && context.currentCycleId),
  },
  {
    id: BUILTIN_VIEW_IDS.nextCycle,
    title: "Next cycle",
    builtin: true,
    predicate: nextCyclePredicate,
    available: (context) => Boolean(context.cyclesEnabled && context.nextCycleId),
  },
  {
    id: BUILTIN_VIEW_IDS.decisions,
    title: "Decisions",
    builtin: true,
    predicate: decisionsPredicate,
    sectionPredicate: decisionsSectionPredicate,
    hideEmptySections: true,
  },
];

const builtinViewsById = new Map(
  BUILTIN_VIEWS.map((view) => [view.id, view] as const),
);

export const isBuiltinViewId = (id: string | undefined): id is BuiltinViewId =>
  id != null && builtinViewsById.has(id as BuiltinViewId);

export const isBuiltinView = (view: BoardView): view is BuiltinView =>
  isBuiltinViewId(view.id);

// Saved view ids are unique per board, built-in ids are the same everywhere, so
// per-board preferences (hide from the tab bar) key built-ins by board.
export const viewTabPreferenceKey = (
  projectId: number | undefined,
  viewId: string,
) => (isBuiltinViewId(viewId) ? `${projectId ?? 0}:${viewId}` : viewId);

export const getBuiltinView = (id: string | undefined) =>
  isBuiltinViewId(id) ? builtinViewsById.get(id) : undefined;

export const buildBuiltinViewContext = (
  project: IProject | null | undefined,
  currentUserId?: number | null,
  now?: Date | number,
): BuiltinViewContext => {
  const cycleWindow = resolveCycleWindow(project?.cycles ?? [], now);
  const displayName = currentUserId == null
    ? undefined
    : (project?.members ?? []).find(
        (member) => member.userId === currentUserId && !member.agentId,
      )?.user?.displayName?.trim();
  return {
    currentUserId,
    currentUserNames: displayName
      ? [...new Set([displayName, displayName.split(/\s+/)[0]])]
      : [],
    now,
    doneSectionTitles: doneColumnTitles(project?.section ?? []),
    cyclesEnabled: project?.cyclesEnabled,
    currentCycleId: cycleWindow.current?.id ?? null,
    nextCycleId: cycleWindow.next?.id ?? null,
  };
};

export const getActiveBoardViewId = (
  project: IProject | null | undefined,
  activeBuiltinViews: Record<number, string>,
) => {
  if (!project) return undefined;
  const builtinViewId = activeBuiltinViews[project.id];
  const builtinView = getBuiltinView(builtinViewId);
  if (builtinView && (!builtinView.available || builtinView.available(buildBuiltinViewContext(project)))) {
    return builtinViewId;
  }
  return (
    project.project_view?.user_project_views[0]?.appliedView?.id ??
    project.project_view?.default_view_id
  );
};
