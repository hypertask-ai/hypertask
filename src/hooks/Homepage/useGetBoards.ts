
import { IProject, IProjectsAll, IUser } from "@/models/model";
import {
  type BoardTasksPayload,
  BOARD_TASKS_KEY,
  fetchBoardTasks,
  getAllProjects,
  hydrateBoardWithPayload,
  type ProjectsAuthorizationDecision,
} from "@/utils/api/Homepage";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6967_TYPED_TASK_READS_FLAG, HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG } from "@/lib/flags/keys";
import { getBoardDetail } from "@/lib/api/typedClient";
import { discardEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { useHydrated } from "@/hooks/General/useHydrated";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import { pendingBoardMoves } from "@/utils/api/global/apiHelpers/moveTaskHandler";
import { getBoardDocument } from "@/lib/firstScreen/boardDocument";
import { MOBILE_BOARD_SWITCHER_QUERY_KEY } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import {
  persistBoardRevocationFallback,
  recordBoardRevocationTombstone,
} from "@/lib/boardSync/revocationTombstone";

export const PROJECTS_ALL_QUERY_KEY = ["projectsAll"] as const;

const RECOVERY_QUIET_MS = 300;
const RECOVERY_MAX_CHECKS = 100;
export const recoverAbortedProjectsAll = (
  queryClient: QueryClient,
  schedule: (run: () => void, ms: number) => void = (run, ms) => { setTimeout(run, ms); },
  pendingMoves: () => number = pendingBoardMoves,
) => {
  let lastUpdate = 0;
  let checks = 0;
  const check = () => {
    const state = queryClient.getQueryState(PROJECTS_ALL_QUERY_KEY);
    if (!state || state.fetchStatus === "fetching") return;
    const busy = queryClient.isMutating() > 0 || pendingMoves() > 0 || state.dataUpdatedAt !== lastUpdate;
    lastUpdate = state.dataUpdatedAt;
    if (busy) {
      if (++checks < RECOVERY_MAX_CHECKS) schedule(check, RECOVERY_QUIET_MS);
      return;
    }
    void queryClient
      .invalidateQueries({ queryKey: PROJECTS_ALL_QUERY_KEY, exact: true, refetchType: "active" })
      .catch(() => undefined);
  };
  schedule(() => {
    lastUpdate = queryClient.getQueryState(PROJECTS_ALL_QUERY_KEY)?.dataUpdatedAt ?? 0;
    schedule(check, RECOVERY_QUIET_MS);
  }, 0);
};
const PROJECTS_ALL_HYDRATING_QUERY_KEY = [
  ...PROJECTS_ALL_QUERY_KEY,
  "hydrating",
] as const;
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

  await queryClient.cancelQueries(revokedBoardTasks, { revert: false });
  queryClient.removeQueries(revokedBoardTasks);
};

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
  isCurrent?: () => boolean;
}): Promise<void> => {
  const stillRevokingActiveBoard = isCurrent ?? (() => true);
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
  const stubWritten =
    (await clearLocalBoard(accountId, projectId).catch(() => false)) ||
    (await clearLocalBoard(accountId, projectId).catch(() => false));
  if (!stubWritten) persistBoardRevocationFallback(accountId, projectId);
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
  const typedClient = useFlag(HTPR_6967_TYPED_TASK_READS_FLAG);
  const boardCardFresh = useFlag(HTPR_7129_BOARD_CARD_FRESH_AFTER_ESCAPE_FLAG);
  let boardReader: typeof getBoardDetail | undefined;
  if (typedClient) boardReader = getBoardDetail;
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const accountIdRef = useRef(user.id);
  const optionsRef = useRef(options);
  const renderedProjectId = normalizeRequestedProjectId(slugs);
  const document = getBoardDocument(useFirstScreenSurface(user.id), user.id, renderedProjectId);
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
  } | null>(document ? { scopeKey: `${user.id}:${renderedProjectId}` } : null);
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
    enabled: (options?.enabled ?? true) && (!document || hydrated),
    ...(hydrated || document
      ? {}
      : {
          queryKey: PROJECTS_ALL_HYDRATING_QUERY_KEY,
          enabled: false,
        }),
    queryFn: async ({ signal }) => {
      if (boardCardFresh) signal.addEventListener("abort", () => recoverAbortedProjectsAll(queryClient), { once: true });
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
        const boardTaskUpdatesAtStart = requestProjectId
          ? queryClient.getQueryState(BOARD_TASKS_KEY(requestProjectId, requestAccountId))?.dataUpdateCount ?? 0
          : 0;
        const rawBoardPayloadPromise = requestProjectId
          ? needsProjectAuthorization
            ? fetchBoardTasks(
                requestProjectId,
                requestAccountId,
                signal,
                boardReader,
              )
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
                    boardReader,
                  ),
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
          throw new ActiveBoardPayloadUnavailableError();
        }
        if (document && requestProjectId != null && isCurrent()) {
          const taskState = queryClient.getQueryState<BoardTasksPayload>(BOARD_TASKS_KEY(requestProjectId, requestAccountId));
          const index = projects.updatedProjects.findIndex(project => project.id === requestProjectId);
          if (index >= 0 && taskState?.data && taskState.dataUpdateCount > boardTaskUpdatesAtStart) {
            projects.updatedProjects[index] = hydrateBoardWithPayload(projects.updatedProjects[index], taskState.data);
          }
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
      !hydrated ||
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

    if (document && projectAuthorizationScopeRef.current?.scopeKey === currentScopeKey) {
      void query.refetch().catch(() => undefined);
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
    document,
    hydrated,
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
  const typedClient = useFlag(HTPR_6967_TYPED_TASK_READS_FLAG);
  let boardReader: typeof getBoardDetail | undefined;
  if (typedClient) boardReader = getBoardDetail;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !user?.id || !projectId) return;

    void queryClient
      .prefetchQuery({
        queryKey: BOARD_TASKS_KEY(Number(projectId), user.id),
        queryFn: ({ signal }) =>
          fetchBoardTasks(Number(projectId), user.id, signal, boardReader),
        staleTime: BOARD_TASKS_STALE_TIME_MS,
      })
      .catch(() => undefined);
  }, [enabled, projectId, queryClient, user, typedClient]);
};
