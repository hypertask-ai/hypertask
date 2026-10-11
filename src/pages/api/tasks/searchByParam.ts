import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/task-writes/search-by-param")).GET,
}, {
  methodNotAllowed: { message: "Method not allowed." },
});
