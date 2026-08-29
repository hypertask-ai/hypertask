import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecoilValue } from "@/lib/state";
import {
  connectRealtimeClient,
  releaseRealtimeClientIfIdle,
} from "@/lib/realtime/client";
import { TIME_EVENT, timeBoardChannel, timeTaskChannel } from "@/lib/realtime/shared";
import { currentProjectAtom } from "@/store";
import {
  legacyBoardTimeTotal,
  type BoardTimeTotal,
} from "@/lib/boardTimeTotals";
import { timeEntryCreatedInvalidationKeys } from "@/lib/timeTrackingInvalidation";

export interface TimeEntry {
  id: number;
  taskId: number;
  userId: number;
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
}

export interface TaskTimeSummary {
  enabled: boolean;
  runningEntry: TimeEntry | null;
  activeRunningEntryCount: number;
  myTotalSeconds: number;
  taskTotalSeconds: number;
  // Total minus the caller's own running entry, so the client can tell other
  // time on the ticket from the run in progress without doing clock maths.
  otherEntriesSeconds: number;
}

export interface RunningTimeEntry extends TimeEntry {
  task: {
    id: number;
    uniqueIndex: number;
    title: string;
    projectId: number;
    ticketNumber: string | null;
    project: { name: string };
  };
}

type BoardTimeSummaryEntry = {
  taskId: number;
  totalSeconds: number;
  calculatedAt: string;
  runningEntries: Array<{
    startedAt: string;
    pausedAt: string | null;
    userName: string;
  }>;
};

export interface TaskTimeEntry {
  id: number;
  userId: number;
  userName: string;
  note?: string | null;
  startedAt: string;
  endedAt: string | null;
  pausedAt: string | null;
  createdAt: string;
  seconds: number;
}

export interface TimeReportEntry extends TaskTimeEntry {
  canManage: boolean;
  taskId: number;
  task: {
    uniqueIndex: number;
    ticketNumber: string | null;
    title: string;
    projectId: number;
    projectName: string;
  };
}

export interface TimeReportParams {
  team?: string;
  board?: string | number | Array<string | number>;
  task?: string | number;
  user?: string | number | Array<string | number>;
  from?: string;
  to?: string;
  running?: boolean;
}

export interface BoardTaskSearchResult {
  id: number;
  uniqueIndex: number;
  ticketNumber: string | null;
  title: string;
}

export const runningTimersQueryKey = ["time", "running"] as const;
export const timeReportQueryKey = ["time", "report"] as const;
export const boardRunningTimersQueryKey = (projectId: number | null) =>
  ["time", "running-board", projectId] as const;
export const taskTimeQueryKey = (taskId: number | null) => ["time", "task", taskId] as const;
export const taskTimeEntriesQueryKey = (taskId: number) =>
  ["time", "entries", taskId] as const;

export function useTimerNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  return now;
}

const emptyBoardRunningTimers = new Map<
  number,
  { startedAt: string; pausedAt: string | null; userName: string }
>();

// One Pusher subscription per channel for the whole app, however many
// components ask for it. useBoardRunningTimers is mounted by every task card,
// so binding per instance would fire one invalidation per card per event and
// each would cancel the last one's fetch (HTPR-4700).
const timeChannelRefs = new Map<string, { count: number; release: () => void }>();

function useTimeChannel(channelName: string | null, invalidate: () => void) {
  const handler = useRef(invalidate);
  handler.current = invalidate;

  useEffect(() => {
    if (!channelName) return;

    const existing = timeChannelRefs.get(channelName);
    if (existing) {
      existing.count += 1;
    } else {
      const entry = { count: 1, release: () => {} };
      timeChannelRefs.set(channelName, entry);
      void (async () => {
        const client = await connectRealtimeClient();
        // Identity, not presence: the channel can be released and reacquired
        // while this awaits, and a stale initializer would bind a second
        // listener whose cleanup nobody holds.
        if (!client) return;
        if (timeChannelRefs.get(channelName) !== entry) {
          releaseRealtimeClientIfIdle(client);
          return;
        }
        const channel = client.subscribe(channelName);
        const fire = () => handler.current();
        channel.bind(TIME_EVENT, fire);
        // A dropped connection silently misses events, so pull once on the way
        // back. Not on the first connect: the queries are already fetching on
        // mount and firing here would just restart them.
        let wasConnected = client.connection.state === "connected";
        const onConnected = () => {
          if (wasConnected) fire();
          wasConnected = true;
        };
        client.connection.bind("connected", onConnected);
        entry.release = () => {
          channel.unbind(TIME_EVENT, fire);
          client.connection.unbind("connected", onConnected);
          client.unsubscribe(channelName);
          releaseRealtimeClientIfIdle(client);
        };
      })();
    }

    return () => {
      const entry = timeChannelRefs.get(channelName);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count > 0) return;
      timeChannelRefs.delete(channelName);
      entry.release();
    };
  }, [channelName]);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Time tracking request failed");
  return data;
}

export async function toggleTaskTimer(taskId: number) {
  const summary = await requestJson<{ success: true } & TaskTimeSummary>(
    `/api/time/task?taskId=${taskId}`
  );
  return requestJson(`/api/time/${summary.runningEntry ? "stop" : "start"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
}

export function useTaskTime(taskId: number | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: taskTimeQueryKey(taskId),
    queryFn: async () =>
      requestJson<{ success: true } & TaskTimeSummary>(
        `/api/time/task?taskId=${taskId}`
      ),
    enabled: taskId !== null && taskId > 0,
    refetchOnWindowFocus: true,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
      taskId
        ? queryClient.invalidateQueries({ queryKey: taskTimeEntriesQueryKey(taskId) })
        : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
      queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
    ]);
  };

  // A timer started from another tab, another person, or the CLI is invisible
  // here until the window regains focus, so listen for it (HTPR-4700).
  useTimeChannel(taskId === null ? null : timeTaskChannel(taskId), () => {
    void queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) });
    if (taskId)
      void queryClient.invalidateQueries({
        queryKey: taskTimeEntriesQueryKey(taskId),
      });
  });

  const mutation = useMutation({
    mutationFn: async (action: "start" | "stop") =>
      requestJson(`/api/time/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: invalidate,
  });

  const logMutation = useMutation({
    mutationFn: async (minutes: number) =>
      requestJson("/api/time/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, minutes }),
      }),
    onSuccess: invalidate,
  });

  return {
    ...query,
    start: () => mutation.mutateAsync("start"),
    stop: () => mutation.mutateAsync("stop"),
    toggle: () => mutation.mutateAsync(query.data?.runningEntry ? "stop" : "start"),
    isToggling: mutation.isPending,
    logMinutes: logMutation.mutateAsync,
    isLogging: logMutation.isPending,
  };
}

export function useRunningTimers() {
  return useQuery({
    queryKey: runningTimersQueryKey,
    queryFn: async () => {
      const data = await requestJson<{ success: true; entries: RunningTimeEntry[] }>(
        "/api/time/running"
      );
      return data.entries;
    },
    refetchOnWindowFocus: true,
  });
}

export function useBoardRunningTimers(
  projectId: number | null,
  options?: { enabled?: boolean },
) {
  const currentProject = useRecoilValue(currentProjectAtom);
  const projectEligible =
    projectId !== null &&
    currentProject?.id === projectId &&
    currentProject.timeTrackingEnabled;
  const enabled = (options?.enabled ?? true) && projectEligible;
  const queryClient = useQueryClient();
  useTimeChannel(
    enabled && projectId !== null ? timeBoardChannel(projectId) : null,
    () => {
      void queryClient.invalidateQueries({
        queryKey: boardRunningTimersQueryKey(projectId),
      });
    }
  );
  const query = useQuery({
    queryKey: boardRunningTimersQueryKey(projectId),
    queryFn: async () => {
      const data = await requestJson<{
        success: true;
        calculatedAt: string;
        entries: Omit<BoardTimeSummaryEntry, "calculatedAt">[];
      }>(
        `/api/time/board-summary?board=${projectId}`
      );
      // Return a plain, JSON-serializable array. This query's cache is
      // persisted to localStorage (PersistQueryClientProvider), and a Map
      // deserializes to {} — losing .get/.has/.size and crashing consumers.
      return data.entries.map((entry) => ({
        ...entry,
        calculatedAt: data.calculatedAt,
      }));
    },
    enabled,
    refetchOnWindowFocus: true,
  });

  const timers = useMemo(() => {
    // Array.isArray guards against a stale persisted cache from before this
    // query returned an array (old shape rehydrated from localStorage).
    // Keep valid cached timers while the startup network gate is closed.
    if (!projectEligible || !Array.isArray(query.data)) {
      return emptyBoardRunningTimers;
    }
    const map = new Map<
      number,
      { startedAt: string; pausedAt: string | null; userName: string }
    >();
    query.data.forEach((entry) => {
      const runningEntries = Array.isArray(entry.runningEntries)
        ? entry.runningEntries
        : [entry as unknown as {
            startedAt: string;
            pausedAt: string | null;
            userName: string;
          }];
      const first = runningEntries[0];
      if (first && !map.has(entry.taskId)) {
        map.set(entry.taskId, {
          startedAt: first.startedAt,
          pausedAt: first.pausedAt,
          userName: first.userName,
        });
      }
    });
    return map;
  }, [projectEligible, query.data]);

  const timeTotals = useMemo(() => {
    const totals = new Map<number, BoardTimeTotal>();
    if (!projectEligible || !Array.isArray(query.data)) return totals;
    query.data.forEach((entry) => {
      if (!Array.isArray(entry.runningEntries)) {
        const legacy = entry as unknown as {
          startedAt?: string;
          pausedAt?: string | null;
        };
        if (typeof legacy.startedAt === "string") {
          totals.set(
            entry.taskId,
            legacyBoardTimeTotal({
              startedAt: legacy.startedAt,
              pausedAt: legacy.pausedAt ?? null,
            }),
          );
        }
        return;
      }
      if (
        typeof entry.totalSeconds !== "number" ||
        typeof entry.calculatedAt !== "string"
      ) {
        return;
      }
      totals.set(entry.taskId, {
        calculatedAt: entry.calculatedAt,
        runningTimers: entry.runningEntries,
        totalSeconds: entry.totalSeconds,
      });
    });
    return totals;
  }, [projectEligible, query.data]);

  const timerDataReady = !projectEligible || Array.isArray(query.data);

  return {
    ...query,
    showTimeTotals: Boolean(currentProject?.showTimeTotals),
    timers,
    timeTotals,
    timerDataReady,
    count:
      projectEligible && Array.isArray(query.data)
        ? query.data.reduce(
            (total, entry) =>
              total +
              (Array.isArray(entry.runningEntries)
                ? entry.runningEntries.length
                : 1),
            0,
          )
        : 0,
  };
}

export function useTimeReport(params: TimeReportParams) {
  return useQuery({
    queryKey: [...timeReportQueryKey, params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.team) searchParams.set("team", params.team);
      if (params.board !== undefined) {
        const boards = Array.isArray(params.board) ? params.board : [params.board];
        boards.forEach((board) => searchParams.append("board", String(board)));
      }
      if (params.task !== undefined) searchParams.set("task", String(params.task));
      if (params.user !== undefined) {
        const users = Array.isArray(params.user) ? params.user : [params.user];
        users.forEach((user) => searchParams.append("user", String(user)));
      }
      if (params.from) searchParams.set("from", params.from);
      if (params.to) searchParams.set("to", params.to);
      if (params.running) searchParams.set("running", "1");

      const query = searchParams.toString();
      const data = await requestJson<{ success: true; entries: TimeReportEntry[] }>(
        `/api/time/report${query ? `?${query}` : ""}`
      );
      return data.entries;
    },
    refetchOnWindowFocus: true,
  });
}

export function useBoardTaskSearch(
  board: string | number | null | undefined,
  q: string,
  taskId?: string | number
) {
  return useQuery({
    queryKey: ["time", "tasks", board, q, taskId],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ board: String(board) });
      if (q.trim()) searchParams.set("q", q.trim());
      if (taskId) searchParams.set("task", String(taskId));
      const data = await requestJson<{
        success: true;
        tasks: BoardTaskSearchResult[];
      }>(`/api/time/tasks?${searchParams.toString()}`);
      return data.tasks;
    },
    enabled: board !== null && board !== undefined && String(board).length > 0,
  });
}

export function useTaskTimeEntries(taskId: number, enabled: boolean) {
  const query = useQuery({
    queryKey: taskTimeEntriesQueryKey(taskId),
    queryFn: async () => {
      return requestJson<{
        success: true;
        canManage: boolean;
        entries: TaskTimeEntry[];
      }>(`/api/time/entries?taskId=${taskId}`);
    },
    enabled: enabled && taskId > 0,
    refetchOnWindowFocus: true,
  });

  // Tolerate the legacy array shape restored from persisted query caches.
  const data = query.data as typeof query.data | TaskTimeEntry[];
  return {
    ...query,
    data: Array.isArray(data) ? data : data?.entries,
    canManage: Array.isArray(data) ? false : data?.canManage ?? false,
  };
}

export function useCreateTimeEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      date,
      minutes,
      timezoneOffsetMinutes,
      note,
    }: {
      taskId: number;
      date: string;
      minutes: number;
      timezoneOffsetMinutes: number;
      note?: string | null;
    }) =>
      requestJson("/api/time/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          date,
          minutes,
          timezoneOffsetMinutes,
          note,
        }),
      }),
    onSuccess: async (_data, { taskId }) => {
      await Promise.all(
        timeEntryCreatedInvalidationKeys(taskId).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

function useInvalidateTaskTimeEntries(taskId: number) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskTimeEntriesQueryKey(taskId) }),
      queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
      queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
      queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
    ]);
  };
}

export function useUpdateTimeEntry(taskId: number) {
  const invalidate = useInvalidateTaskTimeEntries(taskId);
  return useMutation({
    mutationFn: async ({
      entryId,
      minutes,
      date,
      timezoneOffsetMinutes,
      note,
    }: {
      entryId: number;
      minutes: number;
      date?: string;
      timezoneOffsetMinutes?: number;
      note?: string | null;
    }) =>
      requestJson("/api/time/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          minutes,
          date,
          timezoneOffsetMinutes,
          note,
        }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTimeEntry(taskId: number) {
  const invalidate = useInvalidateTaskTimeEntries(taskId);
  return useMutation({
    mutationFn: async (entryId: number) =>
      requestJson("/api/time/entries", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTimeEntries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      entries: Array<{ entryId: number; taskId: number }>
    ) => {
      const results: Array<{ entryId: number; success: boolean }> = [];
      for (const entry of entries) {
        try {
          await requestJson("/api/time/entries", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entryId: entry.entryId }),
          });
          results.push({ entryId: entry.entryId, success: true });
        } catch {
          results.push({ entryId: entry.entryId, success: false });
        }
      }
      return results;
    },
    onSettled: async (_data, _error, entries) => {
      const taskIds = [...new Set(entries.map((entry) => entry.taskId))];
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
        queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        ...taskIds.flatMap((taskId) => [
          queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
          queryClient.invalidateQueries({
            queryKey: taskTimeEntriesQueryKey(taskId),
          }),
        ]),
      ]);
    },
  });
}

export function useStopTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: number) =>
      requestJson("/api/time/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: async (_data, taskId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: taskTimeEntriesQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
      ]);
    },
  });
}

export function usePauseTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: number) =>
      requestJson("/api/time/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: async (_data, taskId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: taskTimeEntriesQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
      ]);
    },
  });
}

export function useResumeTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: number) =>
      requestJson("/api/time/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }),
    onSuccess: async (_data, taskId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: runningTimersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["time", "running-board"] }),
        queryClient.invalidateQueries({ queryKey: taskTimeQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: taskTimeEntriesQueryKey(taskId) }),
        queryClient.invalidateQueries({ queryKey: timeReportQueryKey }),
      ]);
    },
  });
}
