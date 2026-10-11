import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/task-writes/single-read-delete")).GET,
  PUT: async () => (await import("@/lib/api/task-writes/update")).PUT,
  DELETE: async () => (await import("@/lib/api/task-writes/single-read-delete")).DELETE,
});
