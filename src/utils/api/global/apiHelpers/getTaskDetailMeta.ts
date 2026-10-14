import axios from "axios";

export type TaskDetailMeta = {
  priority: any;
  estimate: any;
  labels: any[];
  followers: any[];
};

const inFlight = new Map<number, Promise<TaskDetailMeta>>();

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
  setTimeout(() => inFlight.delete(taskId), 0);

  return request;
};
