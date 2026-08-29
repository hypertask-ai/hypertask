import type { QueryClient } from "@tanstack/react-query";
import {
  BOARD_SYNC_PILOT_PARAM,
  getBoardSyncPilotEnabled,
} from "@/lib/boardSync/pilot";
import {
  buildInboxQueryCache,
  type InboxQueryPayload,
} from "@/utils/helperFunctions/helperFunctions";
import {
  isInboxReadModelRevision,
  reserveInboxReadModelRevision,
} from "./revision";
import {
  applyInboxReadModelMutation,
  type InboxReadModelMutation,
} from "./mutation";

const localReadModelEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  const parameter = new URLSearchParams(window.location.search).get(
    BOARD_SYNC_PILOT_PARAM,
  );
  return getBoardSyncPilotEnabled(parameter);
};

const persistRevisionFence = async (
  accountId: number,
  revision: NonNullable<InboxQueryPayload["readModelRevision"]>,
): Promise<void> => {
  try {
    const { writeInboxReadModelRevisionFence } =
      await import("./indexedDbReadModel");
    await writeInboxReadModelRevisionFence({ accountId, revision });
  } catch {
    // Optimistic UI remains usable when IndexedDB is unavailable.
  }
};

const asReadModelPayload = (payload: InboxQueryPayload) => {
  if (!isInboxReadModelRevision(payload.readModelRevision)) return null;
  return {
    revision: payload.readModelRevision,
    notifications: payload.notifications,
    splitsNoImportant: payload.splitsNoImportant,
    showImportantSplit: payload.showImportantSplit,
  };
};

const asOptimisticQueryPayload = (
  accountId: number,
  payload: NonNullable<ReturnType<typeof asReadModelPayload>>,
): InboxQueryPayload =>
  buildInboxQueryCache(
    payload.notifications,
    payload.splitsNoImportant,
    payload.showImportantSplit,
    {
      accountId,
      dataOrigin: "optimistic",
      readModelRevision: payload.revision,
    },
  );

export const updateInboxOptimistically = ({
  queryClient,
  queryKey,
  accountId,
  mutation,
}: {
  queryClient: QueryClient;
  queryKey: readonly unknown[];
  accountId: number;
  mutation: InboxReadModelMutation;
}): InboxQueryPayload | null => {
  const current = queryClient.getQueryData<InboxQueryPayload>(queryKey);
  if (
    !current ||
    (current.accountId != null && current.accountId !== accountId)
  ) {
    return null;
  }
  const currentPayload = asReadModelPayload(current);
  if (!currentPayload) {
    // Agent and legacy Inbox queries predate read-model metadata. Preserve
    // their existing immediate cache behavior without persisting them into the
    // account-scoped IndexedDB read model.
    const legacyBase = {
      ...current,
      splitsNoImportant: current.splitsNoImportant ?? [],
      showImportantSplit: current.showImportantSplit ?? false,
    };
    const immediateLegacyPayload = applyInboxReadModelMutation(
      legacyBase,
      mutation,
    );
    const legacyQueryPayload = buildInboxQueryCache(
      immediateLegacyPayload.notifications,
      immediateLegacyPayload.splitsNoImportant,
      immediateLegacyPayload.showImportantSplit,
      {
        accountId: current.accountId,
        dataOrigin: current.dataOrigin,
        readModelRevision: current.readModelRevision,
      },
    );
    queryClient.setQueryData(queryKey, legacyQueryPayload);
    return legacyQueryPayload;
  }

  // Apply the small operation delta immediately for responsive interaction.
  // Only the server-confirmed reconciliation may persist it to IndexedDB.
  const revision = reserveInboxReadModelRevision(accountId);
  if (localReadModelEnabled()) {
    void persistRevisionFence(accountId, revision);
  }
  const immediatePayload = applyInboxReadModelMutation(
    {
      ...currentPayload,
      revision,
    },
    mutation,
  );
  const immediateQueryPayload = asOptimisticQueryPayload(
    accountId,
    immediatePayload,
  );
  queryClient.setQueryData(queryKey, immediateQueryPayload);
  return immediateQueryPayload;
};
