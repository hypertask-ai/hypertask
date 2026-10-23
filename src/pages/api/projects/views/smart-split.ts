import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/project-writes/views/smart-split")).POST,
  PATCH: async () => (await import("@/lib/api/project-writes/views/smart-split")).PATCH,
  DELETE: async () => (await import("@/lib/api/project-writes/views/smart-split")).DELETE,
});
