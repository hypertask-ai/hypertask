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

export function effectiveMyTasksScopes(
  scopes: MyTasksScope[] | undefined,
  flagEnabled: boolean,
): MyTasksScope[] {
  if (!flagEnabled) return [...DEFAULT_MY_TASKS_SCOPES];
  return normalizeMyTasksScopes(scopes ?? DEFAULT_MY_TASKS_SCOPES);
}

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
