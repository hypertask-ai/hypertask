import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/project-writes/last-activity-read")).GET,
});
