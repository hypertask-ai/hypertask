import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getDesktopCliTokenUser } from "@/lib/auth/desktopCliTokenUser";
import { taskWriteHandler } from "@/lib/api/task-writes/route";

export default taskWriteHandler({
  GET: async () => (await import("@/lib/api/task-writes/search-by-param")).GET,
}, {
  authorizationEndpoint: "mention-search",
  authenticate: async (headers) => (await getSessionUser(headers)) ?? (await getDesktopCliTokenUser(headers, "mention-search")),
  methodNotAllowed: { message: "Method not allowed." },
});
