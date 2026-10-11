import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  DELETE: async () => (await import("@/lib/api/task-writes/delete")).DELETE,
});
