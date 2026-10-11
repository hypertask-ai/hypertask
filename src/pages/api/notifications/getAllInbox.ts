import { taskWriteHandler } from "@/lib/api/task-writes/route";

// Every method answers with the shared route, as the old handler accepted any method.
export default taskWriteHandler({
  "*": async () => (await import("@/lib/api/notification-writes/archived-read")).GET,
});
