import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { BOARD_TASKS_KEY } from "./boardPayload";
import { mergeBoardDocumentProjects, type BoardDocument } from "./boardDocument";

export function adoptBoardDocument(client: QueryClient, snapshot: BoardDocument) {
  const updatedAt = Date.parse(snapshot.fetchedAt);
  client.setQueryData(["inbox", "count", snapshot.scope.accountId], snapshot.data.projects.notificationsCount, { updatedAt });
  client.setQueryData(BOARD_TASKS_KEY(snapshot.data.projectId, snapshot.scope.accountId), snapshot.data.payload, { updatedAt });
  client.setQueryData(["projectsAll"], (current: Parameters<typeof mergeBoardDocumentProjects>[0]) =>
    mergeBoardDocumentProjects(current, snapshot.data.projects), { updatedAt });
}

export function excludeBoardDocumentRestore(client: PersistedClient | undefined, snapshot: BoardDocument): PersistedClient | undefined {
  if (!client) return client;
  // Wall clocks cannot prove a persisted authorization result is newer than
  // this request. Keep route keys out of restoration, even with future dates.
  return { ...client, clientState: { ...client.clientState, queries: client.clientState.queries.filter(query => {
    const key = query.queryKey;
    return key[0] !== "projectsAll" &&
      !(key[0] === "boardTasks" && key[1] === snapshot.scope.accountId && key[2] === snapshot.data.projectId) &&
      !(key[0] === "feature-flags" && key[1] === snapshot.scope.accountId) &&
      !(key[0] === "fetchUser" && key[1] === snapshot.scope.accountId) &&
      !(key[0] === "inbox" && key[1] === "count" && key[2] === snapshot.scope.accountId);
  }) } };
}
