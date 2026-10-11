import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/project-writes/favorites-read")).GET,
});
