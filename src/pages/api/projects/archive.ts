import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/project-writes/archive")).POST,
}, {
  methodNotAllowed: { error: "Method not allowed" },
});
