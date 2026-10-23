import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  getAllNotifications,
  getInboxAccessibleProjectIds,
  getNotificationCount,
} from "@/utils/api/Homepage";
import {
  buildInboxQueryCache,
  expandInboxApiResponse,
  type InboxQueryPayload,
} from "@/utils/helperFunctions/helperFunctions";
import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  BOARD_SYNC_PILOT_PARAM,
  getBoardSyncPilotEnabled,
  persistBoardSyncPilotPreference,
} from "@/lib/boardSync/pilot";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";
import {
  compareInboxReadModelRevisions,
  currentInboxReadModelRevision,
  inboxRevisionStorageAvailable,
  isInboxReadModelRevision,
  observeInboxReadModelRevision,
  reserveInboxReadModelRevision,
  type InboxReadModelRevision,
} from "@/lib/inboxSync/revision";
import { filterInboxReadModelByProjectAccess } from "@/lib/inboxSync/contract";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { getInboxDocument } from "@/lib/firstScreen/inboxDocument";
import { getBoardDocument } from "@/lib/firstScreen/boardDocument";

import { INBOX_QUERY_KEY, inboxAccessQueryKey, inboxDataQueryKey } from "@/lib/inboxQueryKeys";
export { INBOX_QUERY_KEY, inboxAccessQueryKey, inboxDataQueryKey };
export const INBOX_QUERY_STALE_TIME_MS = 30 * 1000;

export const fetchInboxAccessibleProjectIds = (
  queryClient: QueryClient,
  userId: number,
) =>
  queryClient.fetchQuery({
    queryKey: inboxAccessQueryKey(userId),
    queryFn: () => getInboxAccessibleProjectIds(),
    staleTime: 0,
  });

const localReadModelParameter = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(
    BOARD_SYNC_PILOT_PARAM,
  );
};

const localReadModelEnabled = (): boolean =>
  getBoardSyncPilotEnabled(localReadModelParameter());

const isInboxRoute = (): boolean =>
  typeof window !== "undefined" &&
  window.location.pathname.startsWith("/inbox");

export const createInboxReadinessLatch = (): { claim: () => boolean } => {
  let claimed = false;
  return {
    claim: () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
  };
};

export const requiresPersistentInboxFence = (
  enabled: boolean,
  revisionStorageAvailable: boolean,
): boolean => enabled && !revisionStorageAvailable;

type LocalReadinessOutcome = "miss" | "error" | "none";
type LocalReadinessOutcomeRef = { current: LocalReadinessOutcome };

const emitInboxReadiness = ({
  userId,
  source,
  startedAt,
  enabled,
  notificationCount,
  localOutcome,
  latch,
}: {
  userId: number;
  source: "indexeddb" | "network";
  startedAt: number;
  enabled: boolean;
  notificationCount: number;
  localOutcome: LocalReadinessOutcome;
  latch: ReturnType<typeof createInboxReadinessLatch>;
}): void => {
  if (!latch.claim()) return;
  if (!isInboxRoute() || typeof performance === "undefined") return;
  if (source === "indexeddb") performance.mark("ht-inbox-indexeddb-ready");
  if (source === "network") performance.mark("ht-inbox-network-ready");
  emitProductPerformanceEvent({
    event: "app_inbox_readiness",
    properties: {
      analytics_surface: "authenticated_app",
      app_hostname: window.location.hostname,
      route_family: "inbox",
      inbox_measurement_version: 2,
      readiness_source: source,
      local_outcome: localOutcome,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      device_class: window.matchMedia("(max-width: 767px)").matches
        ? "mobile"
        : "desktop",
      local_read_model_enabled: enabled,
      notification_count: notificationCount,
    },
  }, userId);
};

const withNetworkOrigin = (
  userId: number,
  payload: InboxQueryPayload,
  revision: InboxReadModelRevision,
): InboxQueryPayload => ({
  ...payload,
  accountId: userId,
  dataOrigin: "network",
  readModelRevision: revision,
});

const persistInboxPayload = async (
  userId: number,
  payload: InboxQueryPayload,
): Promise<void> => {
  if (
    !localReadModelEnabled() ||
    payload.accountId !== userId ||
    !isInboxReadModelRevision(payload.readModelRevision)
  ) {
    return;
  }
  const { writeInboxReadModel } =
    await import("@/lib/inboxSync/indexedDbReadModel");
  await writeInboxReadModel({
    accountId: userId,
    payload: {
      revision: payload.readModelRevision,
      notifications: payload.notifications,
      splitsNoImportant: payload.splitsNoImportant,
      showImportantSplit: payload.showImportantSplit,
    },
  });
};

const emptyInboxPayload = (userId: number): InboxQueryPayload => ({
  ...expandInboxApiResponse({
    structuredData: { data: [], tabs: [] },
    notifications: [],
    splitsNoImportant: [],
    showImportantSplit: false,
  }),
  accountId: userId,
  dataOrigin: "placeholder",
});

const latestNetworkRequestRevisionByAccount = new Map<
  number,
  InboxReadModelRevision
>();
const latestAuthorizationFailureRevisionByAccount = new Map<
  number,
  InboxReadModelRevision
>();

const isInboxAuthorizationError = (error: unknown): boolean => {
  if (error == null || typeof error !== "object") return false;
  const response = (error as { response?: unknown }).response;
  if (response == null || typeof response !== "object") return false;
  const status = (response as { status?: unknown }).status;
  return status === 401 || status === 403;
};

const authorizationFailureBlocksRevision = (
  userId: number,
  revision: InboxReadModelRevision,
): boolean => {
  const failureRevision =
    latestAuthorizationFailureRevisionByAccount.get(userId) ?? null;
  return (
    failureRevision != null &&
    compareInboxReadModelRevisions(failureRevision, revision) >= 0
  );
};

const fetchInboxPayload = async (
  userId: number,
  queryClient: QueryClient,
  startedAt?: number,
  readinessLatch?: ReturnType<typeof createInboxReadinessLatch>,
  readinessLocalOutcome?: LocalReadinessOutcomeRef,
  requireProjectAccess = false,
): Promise<InboxQueryPayload> => {
  const revision = reserveInboxReadModelRevision(userId);
  latestNetworkRequestRevisionByAccount.set(userId, revision);
  const enabled = localReadModelEnabled();
  const sharedHydrationReadPromise = enabled
    ? (async () => {
        const { readInboxReadModel } =
          await import("@/lib/inboxSync/indexedDbReadModel");
        return readInboxReadModel(userId);
      })().catch(() => null)
    : Promise.resolve(null);
  const fenceConnectionPromise = enabled
    ? (async () => {
        const { openInboxReadModelConnection } =
          await import("@/lib/inboxSync/indexedDbReadModel");
        return openInboxReadModelConnection();
      })().catch(() => null)
    : Promise.resolve(null);
  let response: InboxQueryPayload;
  try {
    response = await getAllNotifications(userId);
    if (requireProjectAccess) {
      const access = await fetchInboxAccessibleProjectIds(queryClient, userId);
      if (access.accountId !== userId) throw new Error("Inbox access account does not match document account");
      const filtered = filterInboxReadModelByProjectAccess({ ...response, revision }, access.projectIds);
      response = buildInboxQueryCache(filtered.notifications, filtered.splitsNoImportant, filtered.showImportantSplit);
    }
  } catch (error) {
    if (isInboxAuthorizationError(error)) {
      latestAuthorizationFailureRevisionByAccount.set(userId, revision);
      queryClient.setQueryData(
        inboxDataQueryKey(userId),
        emptyInboxPayload(userId),
      );
    }
    void fenceConnectionPromise.then(async (database) => {
      if (!database) return;
      const { closeInboxReadModelConnection } = await import(
        "@/lib/inboxSync/indexedDbReadModel"
      );
      closeInboxReadModelConnection(database);
    });
    throw error;
  }
  const latestAuthorizationFailure =
    latestAuthorizationFailureRevisionByAccount.get(userId) ?? null;
  if (
    latestAuthorizationFailure != null &&
    compareInboxReadModelRevisions(revision, latestAuthorizationFailure) > 0
  ) {
    latestAuthorizationFailureRevisionByAccount.delete(userId);
  }
  let fallbackPersistedPayload:
    import("@/lib/inboxSync/contract").InboxReadModelPayloadV1 | null = null;
  let persistedRevisionFence: InboxReadModelRevision | null = null;
  const persistentFenceRequired = requiresPersistentInboxFence(
    enabled,
    inboxRevisionStorageAvailable(userId),
  );
  if (persistentFenceRequired) {
    fallbackPersistedPayload = await sharedHydrationReadPromise;
    const { readInboxReadModel, readInboxReadModelRevisionFence } =
      await import("@/lib/inboxSync/indexedDbReadModel");
    fallbackPersistedPayload = await readInboxReadModel(userId);
    if (fallbackPersistedPayload) {
      observeInboxReadModelRevision(userId, fallbackPersistedPayload.revision);
    }
    persistedRevisionFence = await readInboxReadModelRevisionFence(
      userId,
      await fenceConnectionPromise,
    );
    if (persistedRevisionFence) {
      observeInboxReadModelRevision(userId, persistedRevisionFence);
    }
  }
  if (!persistentFenceRequired && enabled) {
    try {
      const { readInboxReadModelRevisionFence } =
        await import("@/lib/inboxSync/indexedDbReadModel");
      persistedRevisionFence = await readInboxReadModelRevisionFence(
        userId,
        await fenceConnectionPromise,
      );
    } catch {
      persistedRevisionFence = null;
    }
    if (persistedRevisionFence) {
      observeInboxReadModelRevision(userId, persistedRevisionFence);
    }
  }
  const current = queryClient.getQueryData<InboxQueryPayload>(
    inboxDataQueryKey(userId),
  );
  const currentRevision = currentInboxReadModelRevision(userId);
  const cachedRevision = isInboxReadModelRevision(current?.readModelRevision)
    ? current.readModelRevision
    : null;
  const responseIsStale =
    [currentRevision, cachedRevision, persistedRevisionFence].some(
      (candidate) =>
        candidate != null &&
        compareInboxReadModelRevisions(revision, candidate) < 0,
    ) ||
    (fallbackPersistedPayload != null &&
      compareInboxReadModelRevisions(
        revision,
        fallbackPersistedPayload.revision,
      ) < 0);
  if (authorizationFailureBlocksRevision(userId, revision)) {
    throw new Error("Ignored Inbox response after authorization failure");
  }
  if (responseIsStale) {
    if (
      fallbackPersistedPayload &&
      compareInboxReadModelRevisions(revision, fallbackPersistedPayload.revision) < 0 &&
      (!cachedRevision ||
        compareInboxReadModelRevisions(
          cachedRevision,
          fallbackPersistedPayload.revision,
        ) < 0)
    ) {
      const access = await fetchInboxAccessibleProjectIds(queryClient, userId);
      if (access.accountId !== userId) {
        throw new Error("Inbox access account does not match local account");
      }
      const persisted = filterInboxReadModelByProjectAccess(
        fallbackPersistedPayload,
        access.projectIds,
      );
      if (authorizationFailureBlocksRevision(userId, revision)) {
        throw new Error(
          "Ignored Inbox persisted fallback after authorization failure",
        );
      }
      const { readInboxReadModelRevisionFence: readLatestRevisionFence } =
        await import("@/lib/inboxSync/indexedDbReadModel");
      const latestPersistedRevision =
        await readLatestRevisionFence(userId);
      const latestObservedRevision = currentInboxReadModelRevision(userId);
      if (
        (latestPersistedRevision != null &&
          compareInboxReadModelRevisions(
            persisted.revision,
            latestPersistedRevision,
          ) < 0) ||
        (latestObservedRevision != null &&
          compareInboxReadModelRevisions(
            persisted.revision,
            latestObservedRevision,
          ) < 0)
      ) {
        throw new Error("Ignored stale persisted Inbox fallback");
      }
      return buildInboxQueryCache(
        persisted.notifications,
        persisted.splitsNoImportant,
        persisted.showImportantSplit,
        {
          accountId: userId,
          dataOrigin: "indexeddb",
          readModelRevision: persisted.revision,
        },
      );
    }
    throw new Error("Ignored stale cross-tab Inbox response");
  }
  const finalRevision = currentInboxReadModelRevision(userId);
  if (
    finalRevision != null &&
    compareInboxReadModelRevisions(revision, finalRevision) < 0
  ) {
    throw new Error("Ignored Inbox response after final revision check");
  }
  const payload = withNetworkOrigin(userId, response, revision);
  if (startedAt != null && readinessLatch != null) {
    emitInboxReadiness({
      userId,
      source: "network",
      startedAt,
      enabled,
      notificationCount: payload.notifications.length,
      localOutcome: readinessLocalOutcome?.current ?? "none",
      latch: readinessLatch,
    });
  }
  if (enabled) void persistInboxPayload(userId, payload);
  return payload;
};

export const notificationCountQueryOptions = (userId: number) => ({
  queryKey: [...INBOX_QUERY_KEY, "count", userId] as const,
  queryFn: () => getNotificationCount(userId),
  staleTime: INBOX_QUERY_STALE_TIME_MS,
});

export const useGetNotificationCount = (
  userId: number,
  options?: { enabled?: boolean },
) => {
  const hydrated = useHydrated();
  const snapshot = useFirstScreenSurface(userId);
  const document = getBoardDocument(snapshot, userId) ?? getInboxDocument(snapshot, userId);
  return useQuery({
    ...notificationCountQueryOptions(userId),
    enabled: options?.enabled ?? true,
    ...(hydrated || document
      ? {}
      : {
          queryKey: [
            ...notificationCountQueryOptions(userId).queryKey,
            "hydrating",
          ],
          enabled: false,
        }),
    initialData: { all: 0, unseen: 0 },
    initialDataUpdatedAt: 0,
  });
};

export const useGetNotifications = (userId: number) => {
  const hydrated = useHydrated();
  const document = getInboxDocument(useFirstScreenSurface(userId), userId);
  const documentAccessRef = useRef({ accountId: userId, required: false });
  if (documentAccessRef.current.accountId !== userId) {
    documentAccessRef.current = { accountId: userId, required: false };
  }
  if (document) documentAccessRef.current.required = true;
  const requireProjectAccess = documentAccessRef.current.required;
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const parameter = searchParams?.get(BOARD_SYNC_PILOT_PARAM) ?? null;
  const startedAtRef = useRef(0);
  const startedAccountRef = useRef<number | null>(null);
  const readinessLatchRef = useRef<ReturnType<
    typeof createInboxReadinessLatch
  > | null>(null);
  const readinessLocalOutcomeRef = useRef<LocalReadinessOutcomeRef | null>(null);
  const getStartedAt = useCallback(() => {
    if (startedAccountRef.current !== userId || startedAtRef.current === 0) {
      startedAccountRef.current = userId;
      startedAtRef.current = performance.now();
      readinessLatchRef.current = createInboxReadinessLatch();
      readinessLocalOutcomeRef.current = { current: "none" };
    }
    return startedAtRef.current;
  }, [userId]);
  const queryKey = useMemo(() => inboxDataQueryKey(userId), [userId]);
  useEffect(() => {
    if (hydrated || document) return;
    void queryClient.prefetchQuery({
      queryKey,
      queryFn: () =>
        fetchInboxPayload(
          userId,
          queryClient,
          getStartedAt(),
          readinessLatchRef.current!,
          readinessLocalOutcomeRef.current!,
          requireProjectAccess,
        ),
      staleTime: INBOX_QUERY_STALE_TIME_MS,
      retry: 3,
    });
  }, [hydrated, document, userId, queryClient, queryKey, getStartedAt, requireProjectAccess]);
  const query = useQuery({
    queryKey,
    ...(hydrated || document
      ? {}
      : {
          queryKey: [...queryKey, "hydrating"] as const,
          enabled: false,
        }),
    queryFn: () =>
      fetchInboxPayload(
        userId,
        queryClient,
        getStartedAt(),
        readinessLatchRef.current!,
        readinessLocalOutcomeRef.current!,
        requireProjectAccess,
      ),
    initialData: () => emptyInboxPayload(userId),
    initialDataUpdatedAt: 0,
    staleTime: INBOX_QUERY_STALE_TIME_MS,
  });

  useEffect(() => {
    if (!hydrated) return;
    const startedAt = getStartedAt();
    const readinessLatch = readinessLatchRef.current!;
    const readinessLocalOutcome = readinessLocalOutcomeRef.current!;
    persistBoardSyncPilotPreference(parameter);
    const enabled = getBoardSyncPilotEnabled(parameter);
    const existing = queryClient.getQueryData<InboxQueryPayload>(queryKey);

    if (!enabled) {
      if (
        existing?.accountId === userId &&
        existing.dataOrigin !== "network" &&
        existing.dataOrigin !== "placeholder"
      ) {
        void queryClient.resetQueries({ queryKey, exact: true });
      }
      return;
    }

    if (existing?.dataOrigin && existing.dataOrigin !== "placeholder") return;

    let cancelled = false;
    void (async () => {
      try {
        const { readInboxReadModel } =
          await import("@/lib/inboxSync/indexedDbReadModel");
        const [storedPayload, access] = await Promise.all([
          readInboxReadModel(userId),
          fetchInboxAccessibleProjectIds(queryClient, userId),
        ]);
        if (cancelled) return;
        if (access.accountId !== userId) {
          throw new Error("Inbox access account does not match local account");
        }

        const current = queryClient.getQueryData<InboxQueryPayload>(queryKey);
        if (current?.dataOrigin && current.dataOrigin !== "placeholder") return;
        if (!storedPayload) {
          readinessLocalOutcome.current = "miss";
          return;
        }

        const payload = filterInboxReadModelByProjectAccess(
          storedPayload,
          access.projectIds,
        );

        const latestObservedRevision = currentInboxReadModelRevision(userId);
        const latestNetworkRequestRevision =
          latestNetworkRequestRevisionByAccount.get(userId) ?? null;
        const latestQueryPayload =
          queryClient.getQueryData<InboxQueryPayload>(queryKey);
        const latestQueryRevision = isInboxReadModelRevision(
          latestQueryPayload?.readModelRevision,
        )
          ? latestQueryPayload.readModelRevision
          : null;
        if (latestAuthorizationFailureRevisionByAccount.has(userId)) {
          throw new Error(
            "Ignored Inbox hydration after authorization failure",
          );
        }
        const hydrationIsStale = [
          latestObservedRevision === latestNetworkRequestRevision
            ? null
            : latestObservedRevision,
          latestQueryRevision,
        ].some(
          (candidate) =>
            candidate != null &&
            compareInboxReadModelRevisions(payload.revision, candidate) < 0,
        );
        if (hydrationIsStale) {
          throw new Error("Ignored stale cross-tab Inbox hydration");
        }

        const hydrated = buildInboxQueryCache(
          payload.notifications,
          payload.splitsNoImportant,
          payload.showImportantSplit,
          {
            accountId: userId,
            dataOrigin: "indexeddb",
            readModelRevision: payload.revision,
          },
        );
        observeInboxReadModelRevision(userId, payload.revision);
        queryClient.setQueryData(queryKey, hydrated);
        emitInboxReadiness({
          userId,
          source: "indexeddb",
          startedAt,
          enabled: true,
          notificationCount: hydrated.notifications.length,
          localOutcome: "none",
          latch: readinessLatch,
        });
      } catch {
        if (cancelled) return;
        readinessLocalOutcome.current = "error";
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getStartedAt, hydrated, parameter, queryClient, queryKey, userId]);

  return query;
};

export const prefetchInboxQuery = (queryClient: QueryClient, userId: number) =>
  queryClient
    .prefetchQuery({
      queryKey: inboxDataQueryKey(userId),
      queryFn: () => fetchInboxPayload(userId, queryClient),
      staleTime: INBOX_QUERY_STALE_TIME_MS,
    })
    .catch(() => undefined);
