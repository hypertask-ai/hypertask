import type { MyTasksScope } from "@/lib/myTasksScopes";
import { parseMyTasksDefaultBoardId } from "@/models/MyTasksView";

/** Prefer a saved default board that is still in the writable board list. */
export function resolveMyTasksQuickAddBoardId(
  defaultBoardId: unknown,
  writableBoardIds: ReadonlySet<number> | readonly number[] | undefined,
): number | null {
  const parsed = parseMyTasksDefaultBoardId(defaultBoardId);
  if (parsed === null) return null;
  // undefined = access list not loaded yet; keep the saved id for create to authorize.
  if (writableBoardIds === undefined) return parsed;
  const writable =
    writableBoardIds instanceof Set
      ? writableBoardIds
      : new Set(writableBoardIds);
  if (writable.size === 0) return null;
  return writable.has(parsed) ? parsed : null;
}

/**
 * A task created by and assigned to the current user is visible under the
 * default assigned/created scopes. Watching-only views hide it until followed.
 */
export function myTasksQuickAddLikelyVisible(
  scopes: readonly MyTasksScope[],
): boolean {
  return scopes.some(
    (scope) => scope === "assigned" || scope === "created",
  );
}
