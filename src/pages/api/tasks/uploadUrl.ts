import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/task-writes/upload-url")).POST,
}, {
  methodNotAllowed: { error: "Method not allowed" },
});
