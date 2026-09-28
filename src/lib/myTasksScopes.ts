import type { Prisma } from "@prisma/client";

export const MY_TASKS_SCOPE_VALUES = [
  "assigned",
  "created",
  "mentioned",
  "watching",
] as const;

export type MyTasksScope = (typeof MY_TASKS_SCOPE_VALUES)[number];

const SCOPE_SET = new Set<string>(MY_TASKS_SCOPE_VALUES);

export const DEFAULT_MY_TASKS_SCOPES: MyTasksScope[] = ["assigned"];

type MyTasksBoardScope = {
  id: number;
  title: string;
};

export type MyTasksBoardScopeOption = {
  id: number | null;
  label: string;
  selected: boolean;
};

export function buildMyTasksBoardScopeOptions(
  boards: MyTasksBoardScope[],
  selectedBoardIds: number[] | null,
): MyTasksBoardScopeOption[] {
  const selected = new Set(
    selectedBoardIds ?? boards.map((board) => board.id),
  );
  return [
    {
      id: null,
      label: "All boards",
      selected: selectedBoardIds === null,
    },
    ...boards.map((board) => ({
      id: board.id,
      label: board.title,
      selected: selected.has(board.id),
    })),
  ];
}

export function toggleMyTasksBoardScope(
  selectedBoardIds: number[] | null,
  availableBoardIds: number[],
  boardId: number | null,
): number[] | null {
  if (boardId === null) return null;
  const selected = new Set(selectedBoardIds ?? availableBoardIds);
  if (selected.has(boardId)) selected.delete(boardId);
  else selected.add(boardId);
  const next = availableBoardIds.filter((id) => selected.has(id));
  return next.length === availableBoardIds.length ? null : next;
}

/** Allowlists and dedupes. Empty or garbage input becomes assigned-only. */
export function normalizeMyTasksScopes(value: unknown): MyTasksScope[] {
  if (!Array.isArray(value)) return [...DEFAULT_MY_TASKS_SCOPES];
  const selected = new Set<MyTasksScope>();
  for (const entry of value) {
    if (typeof entry !== "string" || !SCOPE_SET.has(entry)) continue;
    selected.add(entry as MyTasksScope);
  }
  const unique = MY_TASKS_SCOPE_VALUES.filter((scope) => selected.has(scope));
  return unique.length > 0 ? unique : [...DEFAULT_MY_TASKS_SCOPES];
}

/**
 * Flag-off always queries assigned-only. Flag-on uses the saved list.
 * Saved config still keeps scopes when the flag is off so rollout does not wipe them.
 */
export function effectiveMyTasksScopes(
  scopes: MyTasksScope[] | undefined,
  flagEnabled: boolean,
): MyTasksScope[] {
  if (!flagEnabled) return [...DEFAULT_MY_TASKS_SCOPES];
  return normalizeMyTasksScopes(scopes ?? DEFAULT_MY_TASKS_SCOPES);
}

/** One OR clause per selected scope. Caller ANDs this with board-access filters. */
export function buildMyTasksScopeOr(
  userId: number,
  scopes: MyTasksScope[],
): Prisma.TaskWhereInput[] {
  const clauses: Prisma.TaskWhereInput[] = [];
  for (const scope of normalizeMyTasksScopes(scopes)) {
    switch (scope) {
      case "assigned":
        clauses.push({ assignees: { some: { userId, agentId: null } } });
        break;
      case "created":
        clauses.push({ userId });
        break;
      case "watching":
        clauses.push({ followers: { some: { userId, agentId: null } } });
        break;
      case "mentioned": {
        // TipTap mention chips store the user as data-label="name-{userId}".
        const mentionMarker = `data-label="name-${userId}"`;
        clauses.push({
          OR: [
            { comments: { some: { text: { contains: mentionMarker } } } },
            { description: { contains: mentionMarker } },
          ],
        });
        break;
      }
    }
  }
  return clauses;
}
