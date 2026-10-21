import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  "*": async () => (await import("@/lib/api/notification-writes/archived-read")).GET,
});
