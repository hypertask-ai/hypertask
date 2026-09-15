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
  if (!scopes || scopes.length === 0) return myTasksAPIRoute;
  const params = new URLSearchParams();
  params.set("scopes", scopes.join(","));
  return `${myTasksAPIRoute}?${params.toString()}`;
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

  const run = async (): Promise<void> => {
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
        dirty = true;
        generation += 1;
        controller?.abort();
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

export const parseMyTasksListPayload = (
  body: unknown,
): MyTasksListPayload | null => {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.sections) || !Array.isArray(record.tabs)) {
    return null;
  }
  if (
    !record.sections.every(
      (section) => section !== null && typeof section === "object",
    )
  ) {
    return null;
  }
  if (!record.tabs.every((tab) => typeof tab === "string")) {
    return null;
  }
  const boards = Array.isArray(record.boards)
    ? record.boards.filter(
        (board): board is MyTasksBoardMetadata =>
          board !== null &&
          typeof board === "object" &&
          typeof (board as { id?: unknown }).id === "number",
      )
    : [];
  const accessibleProjectIds = Array.isArray(record.accessibleProjectIds)
    ? record.accessibleProjectIds.filter(
        (id): id is number => typeof id === "number",
      )
    : [];
  return {
    sections: record.sections as ISection[],
    tabs: record.tabs as string[],
    boards,
    accessibleProjectIds,
  };
};
