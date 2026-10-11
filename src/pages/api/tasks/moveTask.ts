import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  PUT: async () => (await import("@/lib/api/task-writes/move")).PUT,
});
