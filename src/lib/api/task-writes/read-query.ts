import type { TaskWriteRequest } from "./route";

export function taskReadQuery(request: TaskWriteRequest): NonNullable<TaskWriteRequest["query"]> {
  if (request.query) return request.query;
  const params = new URL(request.url!).searchParams;
  return Object.fromEntries([...new Set(params.keys())].map((key) => {
    const values = params.getAll(key);
    return [key, values.length === 1 ? values[0] : values];
  }));
}
