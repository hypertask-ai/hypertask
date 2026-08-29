import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { PersistedClient } from "@tanstack/react-query-persist-client";

const NEVER_PERSIST_QUERY_KEYS = [
  "projectsAll",
  "boardTasks",
  "projectLabels",
  "chat-sessions",
  "comments",
  "inbox",
  "agent-inbox",
  "archivedInbox",
  "user-preferences",
];

export const MAX_PERSISTED_QUERY_BYTES = 128 * 1024;
export const MAX_PERSISTED_CLIENT_BYTES = 2 * 1024 * 1024;

const utf8ByteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;

export const shouldDehydratePersistedQuery = (
  query: Parameters<typeof defaultShouldDehydrateQuery>[0]
) => {
  if (
    !defaultShouldDehydrateQuery(query) ||
    NEVER_PERSIST_QUERY_KEYS.includes(query.queryKey[0] as string)
  ) {
    return false;
  }

  try {
    return (
      utf8ByteLength(JSON.stringify(query.state.data)) <=
      MAX_PERSISTED_QUERY_BYTES
    );
  } catch {
    return false;
  }
};

export const limitPersistedClientWithinBudget = (
  client: PersistedClient,
): PersistedClient => {
  const queries = [...client.clientState.queries].sort(
    (left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt
  );
  const emptyClient = {
    ...client,
    clientState: { ...client.clientState, mutations: [], queries: [] },
  };
  const emptySerialized = JSON.stringify(emptyClient);
  let remainingBytes =
    MAX_PERSISTED_CLIENT_BYTES - utf8ByteLength(emptySerialized);
  const keptMutations = [] as typeof client.clientState.mutations;
  const keptQueries = [] as typeof queries;

  if (remainingBytes < 0) {
    return {
      timestamp: 0,
      buster: "",
      clientState: { mutations: [], queries: [] },
    };
  }

  const keepWithinBudget = <T>(items: T[], keptItems: T[]) => {
    for (const item of items) {
      try {
        const itemBytes = utf8ByteLength(JSON.stringify(item));
        const separatorBytes = keptItems.length === 0 ? 0 : 1;
        if (itemBytes + separatorBytes > remainingBytes) continue;
        keptItems.push(item);
        remainingBytes -= itemBytes + separatorBytes;
      } catch {
        continue;
      }
    }
  };

  // Preserve resumable mutations first, then spend the remaining budget on
  // the newest successful queries.
  keepWithinBudget(client.clientState.mutations, keptMutations);
  keepWithinBudget(queries, keptQueries);

  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: keptMutations,
      queries: keptQueries,
    },
  };
};

export const serializePersistedClientWithinBudget = (client: PersistedClient) =>
  JSON.stringify(limitPersistedClientWithinBudget(client));
