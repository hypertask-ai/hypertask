import type { IProject, ITask, IView } from "@/models/model";
import { doneColumnTitles, isDoneColumn } from "@/lib/doneColumns";

export const BUILTIN_VIEW_IDS = {
  myTasks: "builtin:my-tasks",
  overdue: "builtin:overdue",
  blocked: "builtin:blocked",
  agents: "builtin:agents",
} as const;

export type BuiltinViewId =
  (typeof BUILTIN_VIEW_IDS)[keyof typeof BUILTIN_VIEW_IDS];

export interface BuiltinViewContext {
  currentUserId?: number | null;
  now?: Date | number;
  doneSectionTitles?: ReadonlySet<string>;
}

export interface BuiltinView {
  id: BuiltinViewId;
  title: string;
  builtin: true;
  predicate: (task: ITask, context: BuiltinViewContext) => boolean;
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
  task.waitingOnUserId != null || (task._count?.relatedFromTasks ?? 0) > 0;

export const agentsPredicate: BuiltinView["predicate"] = (task) =>
  (task.assignees ?? []).some((assignee) => assignee.agentId != null);

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
): BuiltinViewContext => ({
  currentUserId,
  now,
  doneSectionTitles: doneColumnTitles(project?.section ?? []),
});

export const getActiveBoardViewId = (
  project: IProject | null | undefined,
  activeBuiltinViews: Record<number, string>,
) => {
  if (!project) return undefined;
  const builtinViewId = activeBuiltinViews[project.id];
  if (isBuiltinViewId(builtinViewId)) return builtinViewId;
  return (
    project.project_view?.user_project_views[0]?.appliedView?.id ??
    project.project_view?.default_view_id
  );
};
