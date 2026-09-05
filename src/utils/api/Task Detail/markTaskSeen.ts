import axios from "axios";

export type TaskSeenRequestState = {
  key: string | null;
  request: Promise<void> | null;
};

const inFlightRequests = new Map<string, Promise<void>>();

const getRequestKey = (
  userId: number | string,
  taskId: number,
  commentIds: Array<number | string>
) =>
  JSON.stringify([
    String(userId),
    taskId,
    [...new Set(commentIds.map(String))].sort(),
  ]);

const sendTaskSeenRequest = async (
  taskId: number,
  commentIds: Array<number | string>
) => {
  if (commentIds.length > 0) {
    await axios.post("/api/comments/updateSeen", { commentIds, taskId });
    return;
  }

  await axios.post("/api/notifications/getByTask", { taskId });
};

export function markTaskSeen(
  state: TaskSeenRequestState,
  userId: number | string,
  taskId: number,
  commentIds: Array<number | string>
): Promise<void> {
  const key = getRequestKey(userId, taskId, commentIds);
  if (state.key === key && state.request) return state.request;

  let request = inFlightRequests.get(key);
  if (!request) {
    request = sendTaskSeenRequest(taskId, commentIds);
    inFlightRequests.set(key, request);
    // Successful requests live only in caller state, so a later screen open
    // starts fresh while overlapping mounts still share this network write.
    const clearInFlight = () => {
      if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
    };
    void request.then(clearInFlight, clearInFlight);
  }

  state.key = key;
  state.request = request;
  void request.catch(() => {
    if (state.key === key && state.request === request) {
      state.key = null;
      state.request = null;
    }
  });
  return request;
}
