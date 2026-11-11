import { taskWriteHandler } from "@/lib/api/task-writes/route";

export const config = { maxDuration: 300 };

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/task-writes/bulk-archive")).POST,
});
