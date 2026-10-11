import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  POST: async () => (await import("@/lib/api/section-writes/create")).POST,
}, {
  methodNotAllowed: { message: "Method Not Allowed" },
});
