import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/task-writes/upload-finalize")).POST,
}, {
  methodNotAllowed: { error: "Method not allowed" },
});
