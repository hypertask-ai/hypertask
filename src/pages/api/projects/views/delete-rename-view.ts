import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/project-writes/views/delete-rename-view")).POST,
  DELETE: async () => (await import("@/lib/api/project-writes/views/delete-rename-view")).DELETE,
});
