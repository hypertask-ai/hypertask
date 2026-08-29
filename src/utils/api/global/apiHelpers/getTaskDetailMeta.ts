import axios from "axios";

export type TaskDetailMeta = {
  priority: any;
  estimate: any;
  labels: any[];
  followers: any[];
};

// Priority, estimate, labels and followers are four separate react-query keys
// that all mount in the same commit on the task detail page, and used to make
// four separate requests to four separate serverless routes. They share one
// request now (HTPR-3708).
//
// The window is deliberately ONE TICK. The entry is scheduled for deletion the
// moment it is created, so only callers that arrive in the same tick share a
// response: exactly the mount burst, and the three-task prefetch in
// usePrefetchTaskDetail, which calls all four helpers synchronously.
//
// Anything later always issues a fresh request. That matters, because a
// post-write refetch must not be answered with a snapshot taken before the
// write. Setting a priority refetches the priority key immediately; with a
// longer window that refetch could be handed an in-flight response from before
// the change and render the old value. A user action is always many ticks after
// the mount fetch, so it can never land inside this one.
//
// Sharing is only at the network layer: each field keeps its own query key and
// cache entry, so invalidating priority still refreshes just that value.
const inFlight = new Map<number, Promise<TaskDetailMeta>>();

// The consolidated route requires a session, because it returns follower rows
// with full user records on a GET keyed by an autoincrement id. The public
// /share page renders a task with no session at all, and used to read labels
// happily from the old unauthenticated route. So logged-out callers stay on the
// per-field endpoints: they see exactly what they saw before, and the four old
// routes remain the anonymous path rather than becoming dead code.
export const hasSessionCookie = () =>
  typeof document !== "undefined" &&
  /(^|;\s*)nookies_user=/.test(document.cookie);

export const getTaskDetailMeta = (taskId: number): Promise<TaskDetailMeta> => {
  const existing = inFlight.get(taskId);
  if (existing) return existing;

  const request = axios
    .get(`/api/tasks/detailMeta?taskId=${taskId}`)
    .then((r) => r.data as TaskDetailMeta);

  inFlight.set(taskId, request);
  // Same-tick only. Verified on production: the four helpers coalesce into one
  // request with this, and the old per-field routes stop being called.
  //
  // A microtask would be a tighter bound, but react-query does not guarantee the
  // four queryFns run inside one synchronous block, so it can miss the coalescing
  // entirely and cost the whole win. The known looseness of a timer is that
  // background tabs throttle it to roughly once a second: harmless here, because
  // a throttled tab is one nobody is typing in, so there is no post-write refetch
  // for a stale in-flight response to answer.
  //
  // Callers already holding `request` are unaffected; they keep their own
  // reference to it.
  setTimeout(() => inFlight.delete(taskId), 0);

  return request;
};
