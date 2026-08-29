
import { IProject, IProjectsAll, IUser } from "@/models/model";
import {
  type BoardTasksPayload,
  BOARD_TASKS_KEY,
  fetchBoardTasks,
  getAllProjects,
  type ProjectsAuthorizationDecision,
} from "@/utils/api/Homepage";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { discardEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { MOBILE_BOARD_SWITCHER_QUERY_KEY } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import {
  persistBoardRevocationFallback,
  recordBoardRevocationTombstone,
} from "@/lib/boardSync/revocationTombstone";

export const PROJECTS_ALL_QUERY_KEY = ["projectsAll"] as const;
export const PROJECTS_ALL_STALE_TIME_MS = 30 * 1000;
export const BOARD_TASKS_STALE_TIME_MS = 5 * 60 * 1000;

export class ActiveBoardPayloadUnavailableError extends Error {
  constructor() {
    super("Active board payload unavailable");
    this.name = "ActiveBoardPayloadUnavailableError";
  }
}

export const purgeRevokedBoardTaskQueries = async (
  queryClient: QueryClient,
  accountId: number,
  authorizedProjectIds: number[],
): Promise<void> => {
  const authorized = new Set(authorizedProjectIds);
  const revokedBoardTasks = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === "boardTasks" &&
      query.queryKey[1] === accountId &&
      typeof query.queryKey[2] === "number" &&
      !authorized.has(query.queryKey[2]),
  };

  // boardTasks begins before /getAll so it must share /getAll's revocation
  // boundary. Abort first without restoring the pre-cancel snapshot, then
  // remove both settled and in-flight entries for boards no longer visible.
  await queryClient.cancelQueries(revokedBoardTasks, { revert: false });
  queryClient.removeQueries(revokedBoardTasks);
};

// The mobile board switcher keeps its own accessible-board list. Account-wide
// authorization already filters it; a single-board denial has to do the same or
// the denied board stays tappable in the sheet.
const purgeRevokedBoardFromSwitcher = (
  queryClient: QueryClient,
  accountId: number,
  projectId: number,
): void => {
  const switcherKey = MOBILE_BOARD_SWITCHER_QUERY_KEY(accountId);
  const switcherCancellation = queryClient.cancelQueries(
    { queryKey: switcherKey, exact: true },
    { revert: false },
  );
  const switcherCache = queryClient.getQueryData<IProject[]>(switcherKey);
  if (switcherCache?.some((project) => project.id === projectId)) {
    queryClient.setQueryData(
      switcherKey,
      switcherCache.filter((project) => project.id !== projectId),
    );
  }
  // A cancelled active QueryObserver becomes idle. Restart it once the stale
  // response is aborted so an open sheet refetches the authorized list.
  void switcherCancellation
    .then(() =>
      queryClient.invalidateQueries({
        queryKey: switcherKey,
        exact: true,
        refetchType: "active",
      }),
    )
    .catch(() => undefined);
};

// A denial proves only the board it was issued for. Once the route has moved on,
// the revocation may still clean up account-scoped state but must not cancel or
// redirect whatever the user is now looking at.
export const isRevocationStillActiveBoard = ({
  proofIsCurrent,
  currentBoardKey,
  revocationKey,
}: {
  proofIsCurrent: () => boolean;
  currentBoardKey: string;
  revocationKey: string;
}): boolean => proofIsCurrent() && currentBoardKey === revocationKey;

export const revokeBoardAccess = async ({
  queryClient,
  accountId,
  projectId,
  clearLocalBoard,
  router,
  isCurrent,
}: {
  queryClient: QueryClient;
  accountId: number;
  projectId: number;
  clearLocalBoard: (accountId: number, projectId: number) => Promise<boolean>;
  router: { replace: (href: string) => void };
  // The route can change while the cancellation and IndexedDB work below run.
  // A revocation that is no longer the rendered board must do nothing at all.
  isCurrent?: () => boolean;
}): Promise<void> => {
  const stillRevokingActiveBoard = isCurrent ?? (() => true);
  // Every step below is board scoped and destructive. Once the route has moved
  // on, none of it may run: reopening a genuinely denied board 403s again and
  // produces a fresh revocation that is current.
  if (!stillRevokingActiveBoard()) return;
  const revokedBoardTasks = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] === "boardTasks" &&
      query.queryKey[1] === accountId &&
      query.queryKey[2] === projectId,
  };
  await queryClient.cancelQueries(revokedBoardTasks, { revert: false });
  if (!stillRevokingActiveBoard()) return;
  queryClient.removeQueries(revokedBoardTasks);
  purgeRevokedBoardFromSwitcher(queryClient, accountId, projectId);
  queryClient.setQueryData<IProjectsAll>(
    PROJECTS_ALL_QUERY_KEY,
    (current) => {
      if (current?.accountId !== accountId) return current;
      const updatedProjects = current.updatedProjects.filter(
        (project) => project.id !== projectId,
      );
      if (updatedProjects.length === current.updatedProjects.length) {
        return current;
      }
      return {
        ...current,
        index: -1,
        updatedProjects,
      };
    },
  );
  // clearLocalBoard overwrites the snapshot with a revocation stub, which is
  // the durable marker. One retry covers a transient IndexedDB failure.
  const stubWritten =
    (await clearLocalBoard(accountId, projectId).catch(() => false)) ||
    (await clearLocalBoard(accountId, projectId).catch(() => false));
  // The stub is gone but the snapshot may not be. Fall back to a marker
  // outside IndexedDB so a reload still fails closed.
  if (!stubWritten) persistBoardRevocationFallback(accountId, projectId);
  // A local read that started before this revocation may still be in flight.
  recordBoardRevocationTombstone(accountId, projectId);
  if (stillRevokingActiveBoard()) router.replace("/");
};

export const isBoardAccessDeniedError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "response" in error &&
  typeof error.response === "object" &&
  error.response !== null &&
  "status" in error.response &&
  error.response.status === 403;

let projectsAuthorizationRequestSequence = 0;
const nextProjectsAuthorizationRequestId = (): string =>
  `projects-all-${++projectsAuthorizationRequestSequence}`;

export const normalizeRequestedProjectId = (value: unknown): number | null => {
  const projectId = Number(value);
  return Number.isInteger(projectId) && projectId > 0 ? projectId : null;
};

export type ProjectsAuthorizationContext = {
  generation: number;
  requestId: string;
  accountId: number;
  projectId: number | null;
  queryUpdateCountAtAuthorization: number;
  isCurrent: () => boolean;
};

export const isProjectsAuthorizationRequestCurrent = ({
  generation,
  latestGeneration,
  aborted,
  mounted,
}: {
  generation: number;
  latestGeneration: number;
  aborted: boolean;
  mounted: boolean;
}): boolean => mounted && !aborted && generation === latestGeneration;

export const shouldRequestProjectsAuthorizationForScope = ({
  required,
  scopeKey,
  latestGeneration,
  resolvedRequest,
  inFlightRequest,
}: {
  required: boolean;
  scopeKey: string;
  latestGeneration: number;
  resolvedRequest: { scopeKey: string; generation: number } | null;
  inFlightRequest: { scopeKey: string; generation: number } | null;
}): boolean =>
  required &&
  !(
    (resolvedRequest?.scopeKey === scopeKey &&
      resolvedRequest.generation === latestGeneration) ||
    (inFlightRequest?.scopeKey === scopeKey &&
      inFlightRequest.generation === latestGeneration)
  );

export const canUseProjectScopedBoardAuthorization = ({
  payload,
  projectId,
  isCurrent,
  resolvedRequest,
  scopeKey,
  generation,
}: {
  payload: BoardTasksPayload;
  projectId: number;
  isCurrent: () => boolean;
  resolvedRequest: { scopeKey: string; generation: number } | null;
  scopeKey: string;
  generation: number;
}): boolean =>
  isCurrent() &&
  payload.project?.id === projectId &&
  !(
    resolvedRequest?.scopeKey === scopeKey &&
    resolvedRequest.generation === generation
  );

export const shouldForceFreshProjectAuthorization = ({
  scopeKey,
  projectAuthorization,
  resolvedAuthorization,
}: {
  scopeKey: string;
  projectAuthorization: { scopeKey: string } | null;
  resolvedAuthorization: { scopeKey: string } | null;
}): boolean =>
  projectAuthorization?.scopeKey !== scopeKey &&
  resolvedAuthorization?.scopeKey !== scopeKey;

export const useGetAllBoards = (
  user: IUser,
  slugs: any,
  // HTPR-4504: callers that mount before the user is known (the mobile board
  // switcher) must not fire a request with no user — the result would be cached
  // under the shared key and every later consumer would read the error.
  options?: {
    enabled?: boolean;
    onProjectsAuthorized?: (
      projectIds: number[],
      context: ProjectsAuthorizationContext,
    ) =>
      | ProjectsAuthorizationDecision
      | Promise<ProjectsAuthorizationDecision>;
    onActiveBoardAuthorized?: (
      projectId: number,
      context: ProjectsAuthorizationContext,
    ) => void | boolean | Promise<void | boolean>;
    onActiveBoardDenied?: (
      projectId: number,
      context: ProjectsAuthorizationContext,
    ) => void | Promise<void>;
    onCriticalBoardRequestSettled?: () => void;
  }
) => {
  const queryClient = useQueryClient();
  const accountIdRef = useRef(user.id);
  const optionsRef = useRef(options);
  const renderedProjectId = normalizeRequestedProjectId(slugs);
  const currentScopeRef = useRef({
    accountId: user.id,
    projectId: renderedProjectId,
  });
  useLayoutEffect(() => {
    optionsRef.current = options;
    currentScopeRef.current = {
      accountId: user.id,
      projectId: renderedProjectId,
    };
  }, [options, renderedProjectId, user.id]);
  const requestGenerationRef = useRef(0);
  const inFlightRequestRef = useRef<{
    scopeKey: string;
    generation: number;
  } | null>(null);
  const resolvedAuthorizationRequestRef = useRef<{
    scopeKey: string;
    generation: number;
  } | null>(null);
  const projectAuthorizationScopeRef = useRef<{
    scopeKey: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const currentScopeKey = `${user.id}:${renderedProjectId ?? "none"}`;
  const requiresScopedAuthorization = Boolean(options?.onProjectsAuthorized);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const query = useQuery({
    queryKey: PROJECTS_ALL_QUERY_KEY,
    enabled: options?.enabled ?? true,
    queryFn: async ({ signal }) => {
      const generation = ++requestGenerationRef.current;
      const requestId = nextProjectsAuthorizationRequestId();
      const requestAccountId = user.id;
      const requestProjectId = normalizeRequestedProjectId(slugs);
      const requestScopeKey = `${requestAccountId}:${requestProjectId ?? "none"}`;
      inFlightRequestRef.current = {
        scopeKey: requestScopeKey,
        generation,
      };
      const isCurrent = () =>
        isProjectsAuthorizationRequestCurrent({
          generation,
          latestGeneration: requestGenerationRef.current,
          aborted: signal.aborted,
          mounted: mountedRef.current,
        }) &&
        currentScopeRef.current.accountId === requestAccountId &&
        currentScopeRef.current.projectId === requestProjectId;
      try {
        let activeBoardDenialError: unknown;
        const needsProjectAuthorization =
          requestProjectId != null &&
          shouldForceFreshProjectAuthorization({
            scopeKey: requestScopeKey,
            projectAuthorization: projectAuthorizationScopeRef.current,
            resolvedAuthorization: resolvedAuthorizationRequestRef.current,
          });
        const rawBoardPayloadPromise = requestProjectId
          ? needsProjectAuthorization
            ? fetchBoardTasks(
                requestProjectId,
                requestAccountId,
                signal,
              )
              // This request exists only to prove and hydrate the current
              // network result. It must not write BOARD_TASKS_KEY: account-wide
              // authorization may deny and purge the board before this promise
              // settles, and a late side-cache write would resurrect it.
            : queryClient.fetchQuery({
                queryKey: BOARD_TASKS_KEY(
                  requestProjectId,
                  requestAccountId,
                ),
                queryFn: ({ signal: boardSignal }) =>
                  fetchBoardTasks(
                    requestProjectId,
                    requestAccountId,
                    boardSignal,
                  ),
                // Realtime and command refetches keep the existing five-minute
                // task cache once this route's authorization has resolved.
                staleTime: BOARD_TASKS_STALE_TIME_MS,
              })
          : undefined;
        const boardPayloadPromise = rawBoardPayloadPromise
          ?.then((payload) => {
            const isProjectAuthorizationCurrent = () =>
              canUseProjectScopedBoardAuthorization({
                payload,
                projectId: requestProjectId!,
                isCurrent,
                resolvedRequest: resolvedAuthorizationRequestRef.current,
                scopeKey: requestScopeKey,
                generation,
              });
            if (
              !needsProjectAuthorization ||
              requestProjectId == null ||
              !isProjectAuthorizationCurrent()
            ) {
              return payload;
            }

            projectAuthorizationScopeRef.current = {
              scopeKey: requestScopeKey,
            };
            const queryUpdateCountAtAuthorization =
              queryClient.getQueryState<IProjectsAll>(
                PROJECTS_ALL_QUERY_KEY,
              )?.dataUpdateCount ?? 0;
            // The payload is already authorized by its project-scoped route.
            // Start local publication without adding its latency to the
            // network winner; the callback keeps its own generation guards.
            void Promise.resolve()
              .then(() =>
                optionsRef.current?.onActiveBoardAuthorized?.(
                  requestProjectId,
                  {
                    generation,
                    requestId,
                    accountId: requestAccountId,
                    projectId: requestProjectId,
                    queryUpdateCountAtAuthorization,
                    // Full /getAll authorization may resolve while IndexedDB
                    // is still reading. Its allow/deny result wins, so this
                    // project-scoped proof cannot publish afterward.
                    isCurrent: isProjectAuthorizationCurrent,
                  },
                ),
              )
              .catch((error) => {
                console.error(
                  "Failed to publish project-authorized local board",
                  error,
                );
              });
            return payload;
          })
          .catch(async (error) => {
            if (
              requestProjectId != null &&
              isBoardAccessDeniedError(error) &&
              isCurrent()
            ) {
              activeBoardDenialError = error;
              const queryUpdateCountAtAuthorization =
                queryClient.getQueryState<IProjectsAll>(
                  PROJECTS_ALL_QUERY_KEY,
                )?.dataUpdateCount ?? 0;
              await optionsRef.current?.onActiveBoardDenied?.(
                requestProjectId,
                {
                  generation,
                  requestId,
                  accountId: requestAccountId,
                  projectId: requestProjectId,
                  queryUpdateCountAtAuthorization,
                  isCurrent,
                },
              );
            }
            throw error;
          });
        const projects = await getAllProjects(user, slugs, {
          signal,
          boardPayloadPromise,
          onProjectsAuthorized: (projectIds) => {
            if (!isCurrent()) return;
            resolvedAuthorizationRequestRef.current = {
              scopeKey: requestScopeKey,
              generation,
            };
            const queryUpdateCountAtAuthorization =
              queryClient.getQueryState<IProjectsAll>(
                PROJECTS_ALL_QUERY_KEY,
              )?.dataUpdateCount ?? 0;
            const authorizedProjectIds =
              activeBoardDenialError && requestProjectId != null
                ? projectIds.filter(
                    (projectId) => projectId !== requestProjectId,
                  )
                : projectIds;
            return optionsRef.current?.onProjectsAuthorized?.(
              authorizedProjectIds,
              {
                generation,
                requestId,
                accountId: requestAccountId,
                projectId: requestProjectId,
                queryUpdateCountAtAuthorization,
                isCurrent,
              },
            );
          },
          onCriticalBoardRequestSettled: () => {
            if (isCurrent()) {
              optionsRef.current?.onCriticalBoardRequestSettled?.();
            }
          },
        });
        if (activeBoardDenialError) throw activeBoardDenialError;
        if (
          projects.activeBoardPayloadLoaded === false &&
          projects.authorizedLocalBoardPublished === true
        ) {
          // Authorization metadata succeeded, but the visible board payload
          // did not. Rejecting this refresh makes React Query retain the
          // already-authorized local board instead of publishing an empty
          // network shell over it. Normal query retries still recover online.
          throw new ActiveBoardPayloadUnavailableError();
        }
        return {
          ...projects,
          networkRequestScopeKey: requestScopeKey,
          networkRequestGeneration: generation,
          networkRequestId: requestId,
        };
      } finally {
        if (
          inFlightRequestRef.current?.scopeKey === requestScopeKey &&
          inFlightRequestRef.current.generation === generation
        ) {
          inFlightRequestRef.current = null;
        }
      }
    },
    placeholderData: (previousData) =>
      previousData?.accountId === user.id
        ? previousData
        : undefined,
    staleTime: PROJECTS_ALL_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (
      !shouldRequestProjectsAuthorizationForScope({
        required: requiresScopedAuthorization,
        scopeKey: currentScopeKey,
        latestGeneration: requestGenerationRef.current,
        resolvedRequest: resolvedAuthorizationRequestRef.current,
        inFlightRequest: inFlightRequestRef.current,
      })
    ) {
      return;
    }

    let cancelled = false;
    requestGenerationRef.current += 1;
    inFlightRequestRef.current = null;
    resolvedAuthorizationRequestRef.current = null;
    projectAuthorizationScopeRef.current = null;
    void queryClient
      .cancelQueries(
        { queryKey: PROJECTS_ALL_QUERY_KEY, exact: true },
        { revert: false },
      )
      .then(() => {
        const latestScope = currentScopeRef.current;
        const latestScopeKey = `${latestScope.accountId}:${latestScope.projectId ?? "none"}`;
        if (cancelled || latestScopeKey !== currentScopeKey) return;
        return query.refetch({ cancelRefetch: true });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    currentScopeKey,
    query.refetch,
    queryClient,
    requiresScopedAuthorization,
  ]);

  useEffect(() => {
    const projectId = Number(slugs);
    if (
      !Number.isInteger(projectId) ||
      projectId <= 0 ||
      !query.data ||
      query.data.accountId !== user.id ||
      query.isFetching
    ) {
      return;
    }

    // A fresh persisted response won the initial load, so queryFn never
    // consumed the parser-time requests. Remove them before realtime starts.
    discardEarlyBoardBootstrap(user.id, projectId, "projectsAll");
  }, [
    query.data,
    query.isFetching,
    slugs,
    user.id,
  ]);

  useEffect(() => {
    const cached = queryClient.getQueryData<IProjectsAll>(
      PROJECTS_ALL_QUERY_KEY,
    );
    const accountChanged = accountIdRef.current !== user.id;
    accountIdRef.current = user.id;

    if (!accountChanged && (!cached || cached.accountId === user.id)) return;

    // This query predates account-scoped keys and has many mutation consumers.
    // Resetting it clears the previous owner's payload and immediately refetches
    // with this render's authenticated user rather than waiting for staleTime.
    void queryClient.resetQueries({
      queryKey: PROJECTS_ALL_QUERY_KEY,
      exact: true,
    });
  }, [queryClient, user.id]);

  return query;
};

export const useWarmProjectsAllQuery = ({
  user,
  projectId,
  enabled = true,
}: {
  user?: IUser;
  projectId?: number | string | null;
  enabled?: boolean;
}) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !user?.id || !projectId) return;

    void queryClient
      .prefetchQuery({
        // Warm the exact side cache consumed by route startup. Metadata still
        // obtains a fresh scoped authorization response on navigation.
        queryKey: BOARD_TASKS_KEY(Number(projectId), user.id),
        queryFn: ({ signal }) =>
          fetchBoardTasks(Number(projectId), user.id, signal),
        staleTime: BOARD_TASKS_STALE_TIME_MS,
      })
      .catch(() => undefined);
  }, [enabled, projectId, queryClient, user]);
};
