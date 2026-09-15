import { myTasksAPIRoute } from "@/lib/constants/APIRouteConstants";
import type { MyTasksScope } from "@/lib/myTasksScopes";
import type { MyTasksBoardMetadata } from "@/models/MyTasksView";
import type { ISection } from "@/models/model";

export type MyTasksListPayload = {
  sections: ISection[];
  tabs: string[];
  boards: MyTasksBoardMetadata[];
  accessibleProjectIds: number[];
};

export const buildMyTasksListUrl = (scopes?: MyTasksScope[]): string => {
  if (!scopes?.length) return myTasksAPIRoute;
  return `${myTasksAPIRoute}?scopes=${encodeURIComponent(scopes.join(","))}`;
};

export const createMyTasksReconcileRunner = (options: {
  fetchList: (signal: AbortSignal) => Promise<MyTasksListPayload>;
  apply: (payload: MyTasksListPayload) => void;
  onError?: (error: unknown) => void;
}) => {
  let generation = 0;
  let activeRuns = 0;
  let dirty = false;
  let controller: AbortController | null = null;

  const run = async () => {
    if (activeRuns > 0) {
      dirty = true;
      return;
    }
    activeRuns += 1;
    try {
      do {
        dirty = false;
        controller?.abort();
        const next = new AbortController();
        controller = next;
        const gen = ++generation;
        try {
          const payload = await options.fetchList(next.signal);
          if (gen !== generation) continue;
          options.apply(payload);
        } catch (error) {
          if (next.signal.aborted || gen !== generation) continue;
          options.onError?.(error);
        }
      } while (dirty);
    } finally {
      activeRuns = Math.max(0, activeRuns - 1);
    }
  };

  return {
    request: () => {
      if (activeRuns > 0) {
        // Keep the in-flight fetch; trail one more after it finishes.
        dirty = true;
        return;
      }
      void run();
    },
    cancel: () => {
      generation += 1;
      dirty = false;
      controller?.abort();
      controller = null;
    },
  };
};

export const parseMyTasksListPayload = (body: unknown): MyTasksListPayload | null => {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.sections) || !Array.isArray(record.tabs)) return null;
  if (!record.sections.every((s) => s && typeof s === "object")) return null;
  if (!record.tabs.every((t) => typeof t === "string")) return null;
  const boards = Array.isArray(record.boards)
    ? record.boards.filter(
        (b): b is MyTasksBoardMetadata =>
          !!b && typeof b === "object" && typeof (b as { id?: unknown }).id === "number",
      )
    : [];
  const accessibleProjectIds = Array.isArray(record.accessibleProjectIds)
    ? record.accessibleProjectIds.filter((id): id is number => typeof id === "number")
    : [];
  return {
    sections: record.sections as ISection[],
    tabs: record.tabs as string[],
    boards,
    accessibleProjectIds,
  };
};
