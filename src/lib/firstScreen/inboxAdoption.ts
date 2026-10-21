import type { QueryClient } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";
import { reserveInboxReadModelRevision } from "@/lib/inboxSync/revision";
import type { InboxDocument } from "./inboxDocument";

export function adoptInboxDocument(client: QueryClient, snapshot: InboxDocument) {
  const accountId = snapshot.scope.accountId;
  const updatedAt = Date.parse(snapshot.fetchedAt);
  const queryKey = ["inbox", "data", accountId];
  if (client.getQueryData(queryKey)) return;
  client.setQueryData(queryKey, { ...snapshot.data.payload, serverDocumentGeneration: snapshot.scope.generation,
    ...(typeof window === "undefined" ? {} : { readModelRevision: reserveInboxReadModelRevision(accountId) }),
  }, { updatedAt });
  client.setQueryData(["inbox", "count", accountId], snapshot.data.counts, { updatedAt });
  client.setQueryData(["drafts for user:", accountId], snapshot.data.drafts, { updatedAt });
}

export function excludeInboxDocumentRestore(client: PersistedClient | undefined, snapshot: InboxDocument): PersistedClient | undefined {
  if (!client) return client;
  return { ...client, clientState: { ...client.clientState, queries: client.clientState.queries.filter(query => {
    const key = query.queryKey;
    return key[0] !== "inbox" && key[0] !== "user-preferences" &&
      !(key[0] === "drafts for user:" && key[1] === snapshot.scope.accountId) &&
      !(key[0] === "feature-flags" && key[1] === snapshot.scope.accountId) &&
      !(key[0] === "fetchUser" && key[1] === snapshot.scope.accountId);
  }) } };
}
