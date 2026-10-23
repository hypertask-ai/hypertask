import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/notification-writes/matrix")).GET,
  POST: async () => (await import("@/lib/api/notification-writes/matrix")).POST,
});
