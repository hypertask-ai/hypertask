'use client'
import nookies from "nookies"
import {  IFavorites, IProject, IProjectsAll, ISection, IUser } from "@/models/model";

import {     activeBuiltinViewsAtom, showBoardManagerAtom, currentProjectAtom, isXScrollOnKanbanAtom, boardLayoutAtom, boardLayoutPreferenceAtom, showAIChatInterfaceAtom, openAiChatByDefaultAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, appShellRailAtom, showQuickTipsAtom } from "@/store";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import  { lazy, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { debounce, deepCopy } from "@/utils/helperFunctions/helperFunctions";


import { useRouter,useSearchParams,usePathname } from "next/navigation";
import {
  ActiveBoardPayloadUnavailableError,
  PROJECTS_ALL_QUERY_KEY,
  purgeRevokedBoardTaskQueries,
  isRevocationStillActiveBoard,
  type ProjectsAuthorizationContext,
  revokeBoardAccess,
  useGetAllBoards,
} from "@/hooks/Homepage/useGetBoards";
import {
  useGetNotificationCount,
} from "@/hooks/Inbox/useGetNotifications";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAllFavorites } from "@/hooks/MultiPages/useGetAllFavorites";
import HomePage from "@/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage";
import { KanbanModalsProvider } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";

import { addLastActivityAt } from "@/utils/api/helperFunctions";
import { BOARD_TASKS_KEY, fetchBoardTasks, hydrateBoardWithPayload, isBoardPayloadHydrated, isBoardTasksPayload } from "@/utils/api/Homepage";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { MOBILE_BOARD_SWITCHER_QUERY_KEY } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import { getActiveBoardLayoutPreferenceFromProject, getActiveSortingModeFromProject, getViewFromProject, pinProjectToUrlView, resolveBoardLayoutFromSurface } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useDeferredSubscriptionCheck } from "@/hooks/General/useDeferredSubscriptionCheck";
import useViewCyclingShortcuts from "@/hooks/Homepage/Views/useViewCyclingShortcuts";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useTrialModal from "@/hooks/MultiPages/Route/useTrialModal";
import { isGuestUser } from "@/lib/demo/guest";
import NoBoardsEmptyState from "./NoBoardsEmptyState";
import { getFilteredSections } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { getAppliedSubtaskSections } from "@/utils/helperFunctions/Views/SubtaskHelperFunction";
import { getFilteredEmptySections } from "@/utils/helperFunctions/Views/EmptySectionsHelperFunction";
import { buildBuiltinViewContext, getActiveBoardViewId, getBuiltinView, isBuiltinViewId } from "@/lib/constants/builtinViews";
import { buildBoardDocumentTitle } from "@/lib/boardDocumentTitle";
import CycleBoardMeta from "@/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta";
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import {
  type BoardAuthorizationProof,
  usePreparedBoardReadModel,
  useSyncedBoardReadModel,
} from "@/hooks/Homepage/useSyncedBoardReadModel";
import {
  getBoardSyncPilotEnabled,
  persistBoardSyncPilotPreference,
} from "@/lib/boardSync/pilot";
import { useBoardStartup } from "@/lib/contexts/boardStartupContext";
import { discardEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";
import { setLastBoardTeam } from "@/lib/lastBoardTeam";
import {
  type BoardReadinessTraceScope,
  createBoardReadinessRouteEntryId,
  completeBoardReadinessTrace,
  emitBoardReadinessAfterPaint,
  flushBoardReadinessTrace,
  getBoardReadinessTraceScope,
  markBoardNetworkQueryPublished,
  markBoardReadinessPhase,
  prepareBoardReadinessTrace,
} from "@/lib/analytics/boardReadinessPhases";
import {
  markBoardSwitchIntent,
  resolveBoardSwitchIntent,
} from "@/lib/analytics/boardSwitchLatency";
import {
  shouldReleaseSecondaryStartupForTerminalBoard,
  shouldReleaseSecondaryStartupOnBoardRequest,
} from "@/lib/boardStartup/secondaryRequests";
import {
  clearRevokedBoardMarker,
  clearRevokedBoardReadModel,
} from "@/lib/localReadModels/clear";

// React.lazy calls import() only when the conditional branch actually renders.
// next/dynamic preloads client boundaries from this route even while closed.
const TrialModal = lazy(
  () => import("@/components/Modals/TrialPlan/TrialModal"),
);
const TableView = lazy(
  () => import("@/components/PageComponents/Kanban/TableView/TableView"),
);
const Header = lazy(
  () => import("@/components/PageComponents/Kanban/HeaderComponents/header"),
);
const ViewTabsBar = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar"),
);
const AppShellRail = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/AppShellRail"),
);
const ShellViewControls = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/ShellViewControls"),
);
const GuestAuthLinks = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/GuestAuthLinks"),
);

const EMPTY_NOTIFICATION_COUNT = { all: 0, unseen: 0 } as const

const useCommittedBoardReadinessTrace = ({
  accountId,
  projectId,
  routeEntryId,
}: {
  accountId: number;
  projectId: number | null;
  routeEntryId: number;
}): BoardReadinessTraceScope | null => {
  const [scope, setScope] = useState<BoardReadinessTraceScope | null>(null)

  useLayoutEffect(() => {
    if (projectId === null) {
      setScope(null)
      return
    }

    prepareBoardReadinessTrace({ accountId, projectId, routeEntryId })
    setScope(getBoardReadinessTraceScope())
  }, [accountId, projectId, routeEntryId])

  if (
    scope?.accountId !== accountId ||
    scope.projectId !== projectId ||
    scope.routeEntryId !== routeEntryId
  ) {
    return null
  }
  return scope
}


const  LandingPage= ({
  user,
  authenticated,
  slugs
    }: { 
  slugs:any,
  user: IUser,
  authenticated: boolean,
}) =>{

const queryClient = useQueryClient();
const router = useRouter()
const {
  releaseSecondaryStartup,
  secondaryStartupEnabled,
} = useBoardStartup();
const isMblForChat = useContext(MobileViewContext)
const searchParams = useSearchParams()
const pilotParameter = searchParams?.get("local_db")
const currentView = searchParams?.get('view')
const requestedSurface = searchParams?.get('tutorial') === '1'
  ? 'board'
  : searchParams?.get('surface')
const surfaceInitializationKey = `${slugs}:${currentView ?? 'default'}:${requestedSurface === 'board' || requestedSurface === 'table' ? requestedSurface : 'inherit'}`
const [surfaceInitializedFor, setSurfaceInitializedFor] = useState<string | null>(null)
const surfaceResolutionRef = useRef<{
  key: string;
  origin: "indexeddb" | "network";
  appliedLayout: "board" | "table";
  userChangeVersionAtApply: number;
} | null>(null)
const pendingProgrammaticSurfaceRef = useRef<"board" | "table" | null>(null)
const requestedProjectId = Number.isInteger(Number(slugs)) && Number(slugs) > 0
  ? Number(slugs)
  : null
const isGuest = isGuestUser(user);
const boardAccessKey = `${user.id}:${requestedProjectId ?? "none"}`
const readinessRouteEntryId = useMemo(
  () => createBoardReadinessRouteEntryId(),
  [boardAccessKey],
)
// Revocation runs async work. This ref tells a settling revocation whether the
// board it denied is still the rendered one.
const boardAccessKeyRef = useRef(boardAccessKey)
useLayoutEffect(() => {
  boardAccessKeyRef.current = boardAccessKey
}, [boardAccessKey])
// Route rendering can be interrupted. Only a committed layout may replace the
// document-wide trace and clear the previous route's performance marks.
const readinessTraceScope = useCommittedBoardReadinessTrace({
  accountId: user.id,
  projectId: requestedProjectId,
  routeEntryId: readinessRouteEntryId,
})
const [boardAccess, setBoardAccess] = useState<{
  key: string;
  status: "pending" | "local" | "authorized" | "denied";
}>({ key: boardAccessKey, status: "pending" })
const [networkAccess, setNetworkAccess] = useState<{
  key: string;
  generation: number;
  requestId: string | null;
}>({
  key: boardAccessKey,
  generation: 0,
  requestId: null,
})
// Resolve the browser preference during the first render so the prepared
// IndexedDB read can start in the first layout-effect pass.
const [syncedBoardPilotEnabled, setSyncedBoardPilotEnabled] = useState(() =>
  getBoardSyncPilotEnabled(pilotParameter),
)
const [pilotPreferenceResolved, setPilotPreferenceResolved] = useState(true)
const localDatabasePilotEnabled =
  !isGuest &&
  (pilotParameter === "0"
    ? false
    : pilotParameter === "1"
      ? true
      : syncedBoardPilotEnabled)
const pilotExplicitlyDisabled =
  pilotPreferenceResolved && !localDatabasePilotEnabled
const [boardLayout, setBoardLayout] = useRecoilState(boardLayoutAtom)
const lastObservedBoardLayoutRef = useRef(boardLayout)
const userSurfaceChangeVersionRef = useRef(0)
const boardLayoutPreference = useRecoilValue(boardLayoutPreferenceAtom)
const markLocalBoardPublished = useCallback(
  (publishedAccountId: number, publishedProjectId: number) => {
    if (
      publishedAccountId !== user.id ||
      publishedProjectId !== requestedProjectId
    ) {
      return
    }
    setBoardAccess((current) =>
      current.key === boardAccessKey &&
      (current.status === "authorized" || current.status === "denied")
        ? current
        : { key: boardAccessKey, status: "local" },
    )
  },
  [boardAccessKey, requestedProjectId, user.id],
)
const {
  authorizeAndPublishLocalBoard,
  cancelPreparedLocalPublication,
} = usePreparedBoardReadModel({
  enabled: localDatabasePilotEnabled,
  accountId: user.id,
  projectId: requestedProjectId,
  viewSurface:
    requestedSurface === "board" || requestedSurface === "table"
      ? requestedSurface
      : boardLayout,
  queryClient,
  onLocalBoardPublished: markLocalBoardPublished,
})
const latestBoardAuthorizationProofRef = useRef<BoardAuthorizationProof | null>(
  null,
)
const publishedAuthorizationKeyRef = useRef<string | null>(null)
const publishAuthorizedLocalBoard = useCallback(
  (proof: BoardAuthorizationProof) => {
    const proofKey = `${proof.accountId}:${proof.projectId}:${proof.requestId}`
    if (publishedAuthorizationKeyRef.current === proofKey) {
      return Promise.resolve(false)
    }
    publishedAuthorizationKeyRef.current = proofKey
    return authorizeAndPublishLocalBoard(proof)
  },
  [authorizeAndPublishLocalBoard],
)
const boardRevocationRef = useRef<{
  key: string;
  promise: Promise<void>;
} | null>(null)
const revokeActiveBoard = useCallback(
  (
    accountId: number,
    projectId: number,
    authorization: ProjectsAuthorizationContext,
  ) => {
    const revocationKey = `${accountId}:${projectId}`
    const isCurrent = () =>
      isRevocationStillActiveBoard({
        proofIsCurrent: authorization.isCurrent,
        currentBoardKey: boardAccessKeyRef.current,
        revocationKey,
      })
    // Cancelling bumps a shared generation, so a denial that is no longer the
    // rendered board must not cancel the board the user has since opened.
    if (isCurrent()) cancelPreparedLocalPublication()
    setBoardAccess((current) =>
      current.key === revocationKey
        ? { key: current.key, status: "denied" }
        : current,
    )
    // Dedupe per proof, not per board: a second denial carries its own
    // currency check, so reusing the first proof's promise would replay a
    // stale one.
    const proofKey = `${revocationKey}:${authorization.requestId}`
    if (boardRevocationRef.current?.key === proofKey) {
      return boardRevocationRef.current.promise
    }
    const promise = revokeBoardAccess({
      queryClient,
      accountId,
      projectId,
      clearLocalBoard: clearRevokedBoardReadModel,
      router,
      isCurrent,
    })
    // A stale revocation resolves without redirecting. Releasing the memo lets
    // a later denial of the same board redirect instead of reusing it.
    const entry = { key: proofKey, promise }
    boardRevocationRef.current = entry
    void promise
      .finally(() => {
        if (boardRevocationRef.current === entry) {
          boardRevocationRef.current = null
        }
      })
      .catch(() => undefined)
    return promise
  },
  [cancelPreparedLocalPublication, queryClient, router],
)

useEffect(() => {
  if (!localDatabasePilotEnabled) {
    publishedAuthorizationKeyRef.current = null
    return
  }

  const proof = latestBoardAuthorizationProofRef.current
  if (
    !proof ||
    proof.accountId !== user.id ||
    proof.projectId !== requestedProjectId ||
    !proof.isCurrent()
  ) {
    return
  }
  void publishAuthorizedLocalBoard(proof)
}, [
  localDatabasePilotEnabled,
  publishAuthorizedLocalBoard,
  requestedProjectId,
  user.id,
])
const {
  data: fetchedData,
  isFetching: dataFetching,
  isError: projectsError,
  error: projectsErrorCause,
  refetch: refetchProjects,
} = useGetAllBoards(user, slugs, {
  onActiveBoardAuthorized: async (projectId, authorization) => {
    const authorizationMatchesRoute =
      authorization.accountId === user.id &&
      authorization.projectId === requestedProjectId &&
      projectId === requestedProjectId &&
      authorization.isCurrent()
    if (!authorizationMatchesRoute) return false
    // Fresh proof for this board lifts any revocation marker left behind.
    void clearRevokedBoardMarker(authorization.accountId, projectId)

    const authorizationProof: BoardAuthorizationProof = {
      ...authorization,
      projectId,
      // This response proves the requested board only. Restricting the local
      // publication prevents stale metadata for other boards from appearing
      // before /getAll completes account-wide reconciliation.
      authorizedProjectIds: [projectId],
    }
    latestBoardAuthorizationProofRef.current =
      !pilotExplicitlyDisabled ? authorizationProof : null
    setNetworkAccess({
      key: boardAccessKey,
      generation: authorization.generation,
      requestId: authorization.requestId,
    })

    if (!localDatabasePilotEnabled) {
      setBoardAccess({ key: boardAccessKey, status: "authorized" })
      return false
    }

    const localBoardPublished = await publishAuthorizedLocalBoard(
      authorizationProof,
    )
    if (!localBoardPublished || !authorization.isCurrent()) return false

    setBoardAccess({ key: boardAccessKey, status: "authorized" })
    return true
  },
  onActiveBoardDenied: async (projectId, authorization) => {
    const denialMatchesRoute =
      authorization.accountId === user.id &&
      authorization.projectId === requestedProjectId &&
      projectId === requestedProjectId &&
      authorization.isCurrent()
    if (!denialMatchesRoute) return
    setNetworkAccess({
      key: boardAccessKey,
      generation: authorization.generation,
      requestId: authorization.requestId,
    })
    await revokeActiveBoard(authorization.accountId, projectId, authorization)
  },
  onProjectsAuthorized: async (projectIds, authorization) => {
    const revokedBoardTaskPurge = purgeRevokedBoardTaskQueries(
      queryClient,
      authorization.accountId,
      projectIds,
    )
    const authorizationMatchesRoute =
      authorization.accountId === user.id &&
      authorization.projectId === requestedProjectId &&
      authorization.isCurrent()
    const authorized =
      authorizationMatchesRoute &&
      (requestedProjectId == null || projectIds.includes(requestedProjectId))
    if (!authorized) cancelPreparedLocalPublication()
    else if (requestedProjectId != null) {
      void clearRevokedBoardMarker(authorization.accountId, requestedProjectId)
    }
    const authorizationProof =
      authorized && authorization.projectId != null
        ? {
            ...authorization,
            projectId: authorization.projectId,
            authorizedProjectIds: projectIds,
          }
        : null
    // Fresh authorization is also the revocation boundary for the local
    // snapshot. Sanitize IndexedDB-origin metadata immediately—even when the
    // requested board is denied—so no other cache consumer can retain titles
    // or task data for boards the account can no longer access.
    const localCache = queryClient.getQueryData<IProjectsAll>(
      PROJECTS_ALL_QUERY_KEY,
    )
    if (
      localCache?.accountId === authorization.accountId &&
      localCache.dataOrigin === "indexeddb"
    ) {
      const authorizedLocalProjects = localCache.updatedProjects.filter(
        (project) => projectIds.includes(project.id),
      )
      if (authorizedLocalProjects.length !== localCache.updatedProjects.length) {
        queryClient.setQueryData<IProjectsAll>(
          PROJECTS_ALL_QUERY_KEY,
          (current) => {
            if (
              current?.accountId !== authorization.accountId ||
              current.dataOrigin !== "indexeddb"
            ) {
              return current
            }
            return {
              ...current,
              updatedProjects: current.updatedProjects.filter((project) =>
                projectIds.includes(project.id),
              ),
            }
          },
        )
      }
    }
    const switcherKey = MOBILE_BOARD_SWITCHER_QUERY_KEY(authorization.accountId)
    // Abort any response authorized before this proof. TanStack cancellation
    // synchronously signals the request before the promise settles, preventing
    // an older response from repopulating metadata after the purge below.
    const switcherCancellation = queryClient.cancelQueries(
      {
        queryKey: switcherKey,
        exact: true,
      },
      { revert: false },
    )
    const switcherCache = queryClient.getQueryData<IProject[]>(switcherKey)
    if (switcherCache) {
      const authorizedSwitcherProjects = switcherCache.filter((project) =>
        projectIds.includes(project.id),
      )
      if (authorizedSwitcherProjects.length !== switcherCache.length) {
        queryClient.setQueryData(switcherKey, authorizedSwitcherProjects)
      }
    }
    // A cancelled active QueryObserver becomes idle; refetchOnMount does not
    // rerun while the sheet remains mounted. Restart active observers after
    // the stale response is aborted and its previous cache has been purged.
    void switcherCancellation
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: switcherKey,
          exact: true,
          refetchType: "active",
        }),
      )
      .catch(() => undefined)
    latestBoardAuthorizationProofRef.current =
      !pilotExplicitlyDisabled
        ? authorizationProof
        : null
    setBoardAccess({
      key: boardAccessKey,
      status: authorized ? "authorized" : "denied",
    })
    setNetworkAccess({
      key: boardAccessKey,
      generation: authorization.generation,
      requestId: authorization.requestId,
    })
    await revokedBoardTaskPurge
    if (!authorized && authorization.projectId != null) {
      await revokeActiveBoard(
        authorization.accountId,
        authorization.projectId,
        authorization,
      )
      return false
    }
    if (
      authorized &&
      authorizationProof &&
      localDatabasePilotEnabled
    ) {
      return {
        localBoardPublication: publishAuthorizedLocalBoard(
          authorizationProof,
        ),
      }
    }
    return false
  },
  onCriticalBoardRequestSettled: shouldReleaseSecondaryStartupOnBoardRequest({
    isMobile: isMblForChat,
  })
    ? releaseSecondaryStartup
    : undefined,
});
const { data: notificationCount } = useGetNotificationCount(user.id, {
  enabled: secondaryStartupEnabled,
});
const currentBoardAccessStatus =
  boardAccess.key === boardAccessKey ? boardAccess.status : "pending";
const activeBoardPayloadUnavailable =
  projectsErrorCause instanceof ActiveBoardPayloadUnavailableError;
// Use persisted / in-memory cache immediately — don't wait for network
const queryData: IProjectsAll | undefined =
  fetchedData ?? queryClient.getQueryData<IProjectsAll>(PROJECTS_ALL_QUERY_KEY);
const pilotAccessConfirmed =
  currentBoardAccessStatus === "local" ||
  (currentBoardAccessStatus === "authorized" &&
    (!projectsError || activeBoardPayloadUnavailable));
const currentNetworkResultSettled =
  pilotAccessConfirmed &&
  networkAccess.key === boardAccessKey &&
  !dataFetching &&
  !projectsError &&
  queryData?.dataOrigin === "network" &&
  queryData.networkRequestScopeKey === boardAccessKey &&
  queryData.networkRequestGeneration === networkAccess.generation &&
  queryData.networkRequestId === networkAccess.requestId &&
  (requestedProjectId == null ||
    queryData.updatedProjects.some(
      (project) => project.id === requestedProjectId,
    ));
const networkDataAuthorizedForRoute =
  networkAccess.key === boardAccessKey && currentNetworkResultSettled;
const data =
  queryData?.accountId === user.id &&
  ((localDatabasePilotEnabled &&
    pilotAccessConfirmed &&
    queryData.dataOrigin === "indexeddb") ||
    (networkDataAuthorizedForRoute && queryData.dataOrigin === "network"))
    ? queryData
    : undefined;
const hasAccountOwnedNetworkData =
  networkDataAuthorizedForRoute &&
  queryData?.dataOrigin === "network" &&
  queryData.accountId === user.id;
const networkQueryPublished =
  hasAccountOwnedNetworkData && !dataFetching && !projectsError;

// This render is React Query's observer publication boundary: the network
// result is already stored and has now reached its subscribed route. Keep the
// mark synchronous so query-to-commit includes React's remaining render work.
if (networkQueryPublished) {
  markBoardNetworkQueryPublished(readinessTraceScope)
}

useEffect(() => {
  if (networkQueryPublished) flushBoardReadinessTrace(readinessTraceScope);
}, [networkQueryPublished, readinessTraceScope]);

useEffect(() => {
  // A warm react-query result may not run queryFn. Release the secondary
  // startup lane once that cached critical board result is ready as well.
  if (!dataFetching && (fetchedData || projectsError)) {
    if (!isMblForChat) releaseSecondaryStartup();
  }
}, [
  dataFetching,
  fetchedData,
  projectsError,
  releaseSecondaryStartup,
  isMblForChat,
]);
const pathname = usePathname()
const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom)
const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom)
const aiChatAutoOpenSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom)
const aiChatPinned = useRecoilValue(aiChatPinnedAtom)
const welcomeAiHandledRef = useRef(false)
const hydratingRef = useRef<number | null>(null)
const hydrationRetryAttemptsRef = useRef<Record<number, number>>({})
const [hydrationRetryToken, setHydrationRetryToken] = useState(0)
const [hydrationFailedProjectId, setHydrationFailedProjectId] = useState<number | null>(null)
const [projectLookupFailed, setProjectLookupFailed] = useState(false)
useEffect(() => {
  setBoardAccess((current) =>
    current.key === boardAccessKey
      ? current
      : { key: boardAccessKey, status: "pending" },
  )
  setNetworkAccess((current) =>
    current.key === boardAccessKey
      ? current
      : {
          key: boardAccessKey,
          generation: 0,
          requestId: null,
        },
  )
  setProjectLookupFailed(false)
}, [boardAccessKey])

useEffect(() => {
  persistBoardSyncPilotPreference(pilotParameter)
  setSyncedBoardPilotEnabled(getBoardSyncPilotEnabled(pilotParameter))
  setPilotPreferenceResolved(true)
}, [pilotParameter])

const pilotWasExplicitlyDisabledRef = useRef(false)
useEffect(() => {
  if (!pilotPreferenceResolved) return
  if (pilotExplicitlyDisabled) {
    latestBoardAuthorizationProofRef.current = null
    publishedAuthorizationKeyRef.current = null
    pilotWasExplicitlyDisabledRef.current = true
    return
  }
  if (!pilotWasExplicitlyDisabledRef.current) return

  pilotWasExplicitlyDisabledRef.current = false
  latestBoardAuthorizationProofRef.current = null
  publishedAuthorizationKeyRef.current = null
  void refetchProjects()
}, [
  localDatabasePilotEnabled,
  pilotExplicitlyDisabled,
  pilotPreferenceResolved,
  refetchProjects,
])

useEffect(() => {
  if (!pilotExplicitlyDisabled) return
  const cached = queryClient.getQueryData<IProjectsAll>(PROJECTS_ALL_QUERY_KEY)
  if (cached?.accountId !== user.id || cached.dataOrigin !== "indexeddb") return

  // The URL kill switch must remove an already-hydrated local payload, not
  // merely prevent the next IndexedDB read. Reset also refetches this active
  // query through the authoritative network path.
  void queryClient.resetQueries({
    queryKey: PROJECTS_ALL_QUERY_KEY,
    exact: true,
  })
}, [pilotExplicitlyDisabled, queryClient, user.id])

useSyncedBoardReadModel({
  enabled: localDatabasePilotEnabled,
  accountId: user.id,
  projectId: requestedProjectId,
  accessStatus: currentBoardAccessStatus,
  queryClient,
  networkData: fetchedData,
  networkReady: hasAccountOwnedNetworkData && !dataFetching && !projectsError,
})

// HTPR-4303: anonymous guests always get the chat open on board load — it's
// half the demo pitch. HTPR-4998: their manual close no longer suppresses it
// (the persisted flag made the chat look broken forever after one close);
// closing still works within the page until the next board load.
// Find project index client-side
const projectIndex = useMemo(() => {
  if (!data?.updatedProjects || !slugs) return -1; // Return -1 if no data yet
  const targetId = parseInt(slugs);
  const index = data.updatedProjects.findIndex((project: any) => project.id.toString() === targetId.toString());
  // If project not found, return -1 (will be handled in render)
  return index >= 0 ? index : -1;
}, [data?.updatedProjects, slugs]);

useEffect(() => {
  if (!shouldReleaseSecondaryStartupForTerminalBoard({
    isMobile: isMblForChat,
    isFetching: dataFetching,
    hasNoBoards:
      hasAccountOwnedNetworkData && queryData?.updatedProjects.length === 0,
    hasNoSelectedBoard:
      hasAccountOwnedNetworkData && requestedProjectId == null,
    projectsError,
    accessDenied: currentBoardAccessStatus === "denied",
    projectLookupFailed,
    hydrationFailed: hydrationFailedProjectId != null,
  })) return;
  releaseSecondaryStartup();
}, [
  dataFetching,
  currentBoardAccessStatus,
  hasAccountOwnedNetworkData,
  hydrationFailedProjectId,
  isMblForChat,
  projectLookupFailed,
  projectsError,
  queryData?.updatedProjects.length,
  requestedProjectId,
  releaseSecondaryStartup,
])

const projectsForSection = useMemo(() => {
  if (!data?.updatedProjects) return []
  // pinProjectToUrlView returns a new active-project object when it needs an
  // override. A shallow list copy is sufficient; serializing every board and
  // active task here duplicated the largest startup payload on the main thread.
  const projects = [...data.updatedProjects]
  if (projectIndex >= 0 && projects[projectIndex]) {
    projects[projectIndex] = pinProjectToUrlView(projects[projectIndex], currentView)
  }
  return projects
}, [data?.updatedProjects, projectIndex, currentView])

const pinnedProject = projectsForSection[projectIndex]

// Pinning always opens chat. Otherwise, the default setting opens it unless
// a manual close suppressed auto-open or the board is shown on mobile.
useEffect(() => {
  if (
    isMblForChat ||
    (!isGuest &&
      !aiChatPinned &&
      (!openAiChatByDefault || aiChatAutoOpenSuppressed))
  ) return;
  setShowAiChatInterface(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  slugs,
  openAiChatByDefault,
  aiChatAutoOpenSuppressed,
  aiChatPinned,
  isMblForChat,
])

// HTPR-3805: explicit shared-link surfaces always win. An inherited surface may
// paint from IndexedDB first, then reconcile once from authoritative metadata.
// If the user switches surface in between, preserve that newer manual choice.
useEffect(() => {
  if (!pinnedProject) return
  const origin = data?.dataOrigin === "indexeddb" ? "indexeddb" : "network"
  const previous = surfaceResolutionRef.current
  const layoutChanged = lastObservedBoardLayoutRef.current !== boardLayout
  if (pendingProgrammaticSurfaceRef.current === boardLayout) {
    pendingProgrammaticSurfaceRef.current = null
  } else if (layoutChanged && previous?.key === surfaceInitializationKey) {
    userSurfaceChangeVersionRef.current += 1
    pendingProgrammaticSurfaceRef.current = null
  }
  lastObservedBoardLayoutRef.current = boardLayout
  const resolvedLayout = resolveBoardLayoutFromSurface(
    requestedSurface,
    getActiveBoardLayoutPreferenceFromProject(pinnedProject),
    boardLayoutPreference,
  )
  if (!previous || previous.key !== surfaceInitializationKey) {
    surfaceResolutionRef.current = {
      key: surfaceInitializationKey,
      origin,
      appliedLayout: resolvedLayout,
      userChangeVersionAtApply: userSurfaceChangeVersionRef.current,
    }
    pendingProgrammaticSurfaceRef.current = resolvedLayout
    setBoardLayout(resolvedLayout)
    setSurfaceInitializedFor(surfaceInitializationKey)
    return
  }

  if (previous.origin === "indexeddb" && origin === "network") {
    const userChangedSurface =
      userSurfaceChangeVersionRef.current > previous.userChangeVersionAtApply
    const reconciledLayout = userChangedSurface ? boardLayout : resolvedLayout
    surfaceResolutionRef.current = {
      key: surfaceInitializationKey,
      origin: "network",
      appliedLayout: reconciledLayout,
      userChangeVersionAtApply: userSurfaceChangeVersionRef.current,
    }
    if (!userChangedSurface && boardLayout !== resolvedLayout) {
      pendingProgrammaticSurfaceRef.current = resolvedLayout
      setBoardLayout(resolvedLayout)
    }
  }
}, [
  boardLayout,
  boardLayoutPreference,
  data?.dataOrigin,
  pinnedProject,
  requestedSurface,
  setBoardLayout,
  surfaceInitializationKey,
])

// Canonicalize id, view, and one-shot flags in one replace. Keep surface exactly
// as navigation supplied it: materializing a saved/browser layout here would
// turn inherited state into an explicit override on the next view switch.
useEffect(() => {
  if (!searchParams || !slugs || surfaceInitializedFor !== surfaceInitializationKey) return;
  const currentProject = data?.updatedProjects?.[projectIndex]
  const allViews = currentProject?.project_view?.allViews
  const viewMetadataReady = Boolean(currentProject && Array.isArray(allViews))
  const waitingForBoardHydration = Boolean(
    currentProject &&
    !isBoardPayloadHydrated(currentProject) &&
    hydrationFailedProjectId !== currentProject.id
  )
  // A bare board URL needs project metadata to resolve its default/applied
  // view. Replacing while that request is active commits only the surface,
  // then a second render commits the view and produces another RSC navigation.
  // If the request terminates without view metadata, continue with a stable
  // default below so URL cleanup and welcome handling cannot deadlock.
  if (!currentProject || (!viewMetadataReady && (dataFetching || waitingForBoardHydration))) return;
  const urlId = searchParams.get('id');
  const params = new URLSearchParams(searchParams.toString());
  let shouldReplaceUrl = false;

  if (params.get("welcome_ai") === "1" && !welcomeAiHandledRef.current) {
    welcomeAiHandledRef.current = true;
    setShowAiChatInterface(true);
  }

  if (params.has("welcome_ai")) {
    params.delete("welcome_ai");
    shouldReplaceUrl = true;
  }

  // Check if URL ID is missing, empty, or doesn't match the resolved slug
  if (!urlId || urlId === '' || urlId === 'undefined' || urlId === 'null' || urlId !== slugs.toString()) {
    params.set('id', slugs.toString());
    // Keep view param if it exists
    if (currentView) {
      params.set('view', currentView);
    }
    shouldReplaceUrl = true;
  }

  const viewSlug = params.get('view')
  const hasValidViewSlug = viewSlug === "default" || allViews?.some((view) => view.slug === viewSlug)
  if (viewMetadataReady && currentProject && !hasValidViewSlug) {
    const resolvedView = getViewFromProject(currentProject)
    const resolvedViewSlug = resolvedView?.type === "Applied"
      ? resolvedView.view.slug
      : resolvedView?.type === "Unsaved"
        ? currentProject.project_view?.user_project_views[0]?.appliedView?.slug ?? "default"
        : resolvedView?.type === "Default"
          ? "default"
          : undefined
    if (resolvedViewSlug) {
      params.set('view', resolvedViewSlug)
      shouldReplaceUrl = true
    }
  } else if (!viewMetadataReady && !viewSlug) {
    params.set('view', 'default')
    shouldReplaceUrl = true
  }

  if (shouldReplaceUrl) {
    const search = params.toString();
    const newUrl = `/project${search ? `?${search}` : ""}`;
    console.log('🔄 Updating URL:', { from: pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ''), to: newUrl, slugs });
    router.replace(newUrl, { scroll: false });
  }
}, [slugs, searchParams, router, pathname, currentView, setShowAiChatInterface, data?.updatedProjects, dataFetching, projectIndex, surfaceInitializedFor, surfaceInitializationKey, hydrationFailedProjectId]);

// Retry fetching projects if project not found (might be a race condition with instant signup)
const retryCountRef = useRef(0)
const MAX_RETRIES = 3 // Maximum number of retry attempts

useEffect(() => {
  if (!dataFetching && data?.updatedProjects && projectIndex === -1 && slugs) {
    if (retryCountRef.current < MAX_RETRIES) {
      retryCountRef.current += 1
      console.log(`⚠️ Project not found in list, retrying fetch... (attempt ${retryCountRef.current}/${MAX_RETRIES})`, { slugs, projectCount: data.updatedProjects.length })
      // Retry after a short delay to allow database to sync
      const retryTimer = setTimeout(() => {
        refetchProjects()
      }, 1000)
      return () => clearTimeout(retryTimer)
    } else {
      // Max retries reached - project likely doesn't exist or user doesn't have access
      console.error(`❌ Project not found after ${MAX_RETRIES} retries. Redirecting to homepage.`, { slugs })
      // Reset retry counter for next navigation
      retryCountRef.current = 0
      setProjectLookupFailed(true)
      // Redirect to homepage or show error
      router.push('/')
    }
  } else if (projectIndex >= 0) {
    // Project found - reset retry counter
    retryCountRef.current = 0
  }
}, [dataFetching, data?.updatedProjects, projectIndex, slugs, refetchProjects, router])

// HTPR-3811: getAll ships boards WITHOUT their tasks/allViews. Whichever board is active
// (projectIndex / ?id=) must have its board payload hydrated, or it renders empty. Load
// just that one board's payload lazily — reusing the background-prefetched side
// cache when warm — and merge them into the projectsAll blob. One board per
// switch; never re-fetches the whole getAll.
useEffect(() => {
  const proj = data?.updatedProjects?.[projectIndex]
  if (!proj) return
  if (isBoardPayloadHydrated(proj)) {
    discardEarlyBoardBootstrap(user.id, proj.id, "boardTasks")
    delete hydrationRetryAttemptsRef.current[proj.id]
    setHydrationFailedProjectId((failedId) => failedId === proj.id ? null : failedId)
    return
  }
  if (hydratingRef.current === proj.id) return     // hydrate in flight
  hydratingRef.current = proj.id
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  ;(async () => {
    try {
      const warm = queryClient.getQueryData(BOARD_TASKS_KEY(proj.id, user.id))
      if (isBoardTasksPayload(warm)) {
        discardEarlyBoardBootstrap(user.id, proj.id, "boardTasks")
      }
      const boardPayload = isBoardTasksPayload(warm) ? warm : await fetchBoardTasks(proj.id, user.id)
      queryClient.setQueryData(BOARD_TASKS_KEY(proj.id, user.id), boardPayload)
      queryClient.setQueryData(PROJECTS_ALL_QUERY_KEY, (old: any) => {
        if (!old?.updatedProjects) return old
        const idx = old.updatedProjects.findIndex((p: any) => p.id === proj.id)
        if (idx < 0 || isBoardPayloadHydrated(old.updatedProjects[idx])) return old
        const updated = [...old.updatedProjects]
        updated[idx] = hydrateBoardWithPayload(updated[idx], boardPayload)
        return { ...old, updatedProjects: updated }
      })
      delete hydrationRetryAttemptsRef.current[proj.id]
      setHydrationFailedProjectId((failedId) => failedId === proj.id ? null : failedId)
    } catch (e) {
      console.error("Failed to hydrate active board data", e)
      const failedAttempts = (hydrationRetryAttemptsRef.current[proj.id] ?? 0) + 1
      hydrationRetryAttemptsRef.current[proj.id] = failedAttempts
      if (failedAttempts <= 2) {
        retryTimer = setTimeout(
          () => setHydrationRetryToken((token) => token + 1),
          400 * 2 ** (failedAttempts - 1)
        )
      } else {
        setHydrationFailedProjectId(proj.id)
      }
    } finally {
      if (hydratingRef.current === proj.id) hydratingRef.current = null
    }
  })()
  return () => {
    if (retryTimer) clearTimeout(retryTimer)
  }
}, [data?.updatedProjects, hydrationRetryToken, projectIndex, queryClient, user.id])

const retryBoardHydration = () => {
  const projectId = data?.updatedProjects?.[projectIndex]?.id
  if (typeof projectId !== "number") return
  hydrationRetryAttemptsRef.current[projectId] = 0
  setHydrationFailedProjectId(null)
  setHydrationRetryToken((token) => token + 1)
}

//Whenever project is updated via views, fetch sorting mode
const activeSortingMode: TBoardSortingViewMode = useMemo(()=>{
  const currentSortMode = getActiveSortingModeFromProject(pinnedProject);
  return currentSortMode;
},[pinnedProject])

// Update previousBoard cookie whenever user lands on a project
useEffect(() => {
  console.log("🪵 ~ Project data fetched", !!data)
  if (data?.updatedProjects && data.updatedProjects[projectIndex] && slugs) {
    const currentProject = data.updatedProjects[projectIndex];
    const activeView = getViewFromProject(currentProject);
    
    // Determine the view to store in cookie
    let viewToStore = currentView; // Use URL view parameter if present
    if (!viewToStore && activeView && activeView.type === "Applied") {
      viewToStore = activeView.view.slug ?? null; // Fallback to project's active view
    }
    
    // Format: project-{id}|&|{view}
    const cookieValue = `project-${slugs}|&|${viewToStore || ''}`;
    
    // Update the previousBoard cookie
    nookies.set(null, "previousBoard", cookieValue, {
      maxAge: 600 * 60 * 24 * 7, // 1 week
      path: "/",
    });
    
    console.log('✅ Updated previousBoard cookie:', cookieValue);
  }
}, [data?.updatedProjects, projectIndex, slugs, currentView]);

// Defer subscription check to not block initial render
useDeferredSubscriptionCheck({
  teamId: data?.updatedProjects[projectIndex]?.teamId ? Number(data.updatedProjects[projectIndex].teamId) : undefined,
  enabled: secondaryStartupEnabled && !!data?.updatedProjects[projectIndex]?.teamId,
  delay: 1500 // Check after 1.5 seconds
});

useEffect(() => {
  if (!secondaryStartupEnabled) return;
  addLastActivityAt(undefined, user?.id);
}, [secondaryStartupEnabled, user?.id])

return (
    <Suspense fallback={<></>}>

      {data &&
      Array.isArray(data.updatedProjects) &&
      data.updatedProjects.length === 0 ? (
        <NoBoardsEmptyState user={user} />
      ) : data &&
        surfaceInitializedFor === surfaceInitializationKey &&
        data.updatedProjects &&
        projectIndex >= 0 && // Only render if project index is valid
        data.updatedProjects[projectIndex] &&
        isBoardPayloadHydrated(data.updatedProjects[projectIndex]) ? (
           <SectionComp 
            key={readinessRouteEntryId}
            _allProjects={projectsForSection}
            _projectCount={data.updatedProjects.length}
            _currentUser={user}
            _notifications={notificationCount ?? EMPTY_NOTIFICATION_COUNT}
            _projectIndex={projectIndex}       
            _activeSortingMode={activeSortingMode} 
            _authenticated={authenticated && !isGuest}
            _localDatabasePilotEnabled={localDatabasePilotEnabled}
            _readinessSource={data.dataOrigin ?? "unknown"}
            _readinessProjectId={data.updatedProjects[projectIndex].id}
            _readinessRouteEntryId={readinessRouteEntryId}
            />   
      ) : data?.updatedProjects?.[projectIndex] ? (
        hydrationFailedProjectId === data.updatedProjects[projectIndex].id ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
            <p className="text-base font-medium text-heading">Couldn&apos;t load this board.</p>
            <button
              type="button"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
              onClick={retryBoardHydration}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-secondary" role="status">
            Loading board…
          </div>
        )
      ) : null}
    </Suspense>

)

}

export default LandingPage


const SectionComp = ({
  _notifications,
  _allProjects,
  _currentUser, 
  _projectIndex,
  _activeSortingMode,
  _authenticated,
  _localDatabasePilotEnabled,
  _readinessSource,
  _readinessProjectId,
  _readinessRouteEntryId,
}:{
  _notifications:any,
  _allProjects:any,
  _projectCount:number,
  _currentUser:IUser, 
  _projectIndex:number,
  _activeSortingMode: TBoardSortingViewMode,
  _authenticated:boolean,
  _localDatabasePilotEnabled:boolean,
  _readinessSource:"indexeddb" | "network" | "unknown",
  _readinessProjectId:number,
  _readinessRouteEntryId:number,
}) =>{

const router = useRouter();
const queryClient = useQueryClient();
const {
  markBoardUsable,
  releaseSecondaryStartup,
  secondaryStartupEnabled,
} = useBoardStartup();
// const _allProjects = JSON.parse(_allStringifiedProjects)
const [projects, setProjects]= useState<IProject[]>(_allProjects)
const [showBoardManager, setShowBoardManager] = useRecoilState(showBoardManagerAtom);
const boardLayout = useRecoilValue(boardLayoutAtom);
const isMbl = useContext(MobileViewContext);
const appShellRailOn = useRecoilValue(appShellRailAtom) && !isMbl;
const showQuickTips = useRecoilValue(showQuickTipsAtom);
const [_currentProject,setCurrentProject] = useState( _allProjects && _projectIndex >= 0 ? _allProjects[_projectIndex] : null)
const [__, setRecoilCurrentProject] = useRecoilState(currentProjectAtom)
const [sections, setSections] = useState<ISection[]>(deepCopy(_allProjects && _projectIndex >= 0 ? _allProjects[_projectIndex]?.sections : []));
const { setShowTrial, showTrial } = useTrialModal(_currentProject);
const { timers: runningTimers, timerDataReady } = useBoardRunningTimers(
  _currentProject?.id ?? null,
  { enabled: secondaryStartupEnabled },
);
const filterRuntimeContext = useMemo(() => ({
  // A running-only saved view must not render as empty while its deferred timer
  // data is unavailable. Treat every task as a match until cached/network data
  // can answer the filter accurately.
  runningTaskIds: timerDataReady
    ? new Set(runningTimers.keys())
    : new Set(sections.flatMap((section) =>
        (section.items ?? []).map((task) => task.id)
      )),
}), [runningTimers, sections, timerDataReady]);

// Sync currentProject to Recoil when project data is available
useEffect(() => {
  if (_allProjects && _projectIndex >= 0 && _allProjects[_projectIndex]) {
    const project = _allProjects[_projectIndex]
    setCurrentProject(project)
    setRecoilCurrentProject(project)
    if (project.teamId) setLastBoardTeam(project.teamId)
  } else if (_allProjects && _projectIndex === -1) {
    // Project not found - might be a timing issue, set to null
    setCurrentProject(null)
    setRecoilCurrentProject(null)
  }
}, [_allProjects, _projectIndex, setRecoilCurrentProject])

const activeBuiltinViews = useRecoilValue(activeBuiltinViewsAtom);
const filteredSectionsForActiveView = useMemo(() => {
  const persistedFilteredSections = _allProjects?.[_projectIndex]?.filteredSections ?? [];
  if (!_currentProject) return persistedFilteredSections;

  // HTPR-5021: filteredSections is baked by the server for whichever view was
  // applied when getAll ran. Switching a saved view updates project_view in the
  // cache but never regenerates that array, so the board kept rendering the
  // PREVIOUS view's tasks until a refetch. Built-in views were unaffected only
  // because they already recomputed here. Recompute for saved views too, so the
  // rendered set always matches the view that is actually applied.
  const activeViewId = getActiveBoardViewId(_currentProject, activeBuiltinViews);
  const filtered = getFilteredSections(
    sections,
    _currentProject,
    isBuiltinViewId(activeViewId) ? activeViewId : undefined,
    buildBuiltinViewContext(_currentProject, _currentUser.id),
    filterRuntimeContext,
  );
  return getFilteredEmptySections(
    getAppliedSubtaskSections(filtered, _currentProject),
    _currentProject,
  );
}, [
  _allProjects,
  _currentProject,
  _currentUser.id,
  _projectIndex,
  activeBuiltinViews,
  filterRuntimeContext,
  sections,
]);

const [currentIndex, setCurrentIndex] = useState<number>(_projectIndex);
const [favorites, setFavorites] = useState<IFavorites[]>([]);
const [hasHorizontalScrollbar, setHasHorizontalScrollbar] = useRecoilState(isXScrollOnKanbanAtom);
const kanbanContainerRef = useRef<HTMLDivElement>(null);
const restoredScrollForProject = useRef<number | null>(null);
const restoringScroll = useRef(false);
const readinessFrameRef = useRef<number | null>(null);
const readinessPaintFrameRef = useRef<number | null>(null);
const readinessEntryKey = `${_currentUser.id}:${_readinessProjectId}:${_readinessRouteEntryId}`;
const readinessCompletionRef = useRef({
  accountId: _currentUser.id,
  projectId: _readinessProjectId,
  authenticated: _authenticated,
  localDatabasePilot: _localDatabasePilotEnabled,
  readinessSource: _readinessSource,
  viewSurface: boardLayout,
});
const boardReadinessTraceScope = useCommittedBoardReadinessTrace({
  accountId: _currentUser.id,
  projectId: _readinessProjectId,
  routeEntryId: _readinessRouteEntryId,
});

useLayoutEffect(() => {
  if (!boardReadinessTraceScope) return;
  const readinessCompletion = readinessCompletionRef.current;
  markBoardReadinessPhase("firstBoardCommit", boardReadinessTraceScope);
  readinessFrameRef.current = window.requestAnimationFrame(() => {
    readinessPaintFrameRef.current = window.requestAnimationFrame(() => {
      emitBoardReadinessAfterPaint(
        readinessCompletion,
        boardReadinessTraceScope,
      );
      resolveBoardSwitchIntent(readinessCompletion);
      completeBoardReadinessTrace(
        readinessCompletion,
        boardReadinessTraceScope,
      );
      markBoardUsable();
      releaseSecondaryStartup();
    });
  });

  return () => {
    if (readinessFrameRef.current !== null) {
      window.cancelAnimationFrame(readinessFrameRef.current);
    }
    if (readinessPaintFrameRef.current !== null) {
      window.cancelAnimationFrame(readinessPaintFrameRef.current);
    }
  };
}, [
  boardReadinessTraceScope,
  markBoardUsable,
  readinessEntryKey,
  releaseSecondaryStartup,
]);

const {data:favoritesTQ} = useGetAllFavorites(
  _currentUser.UserSettingId,
  _currentUser.id,
  { enabled: secondaryStartupEnabled },
)
const { goToProjectShortcut } = useProjectQuery()
useGetAllTeamsMinimal(_currentUser?.id ?? null, undefined, {
  enabled: secondaryStartupEnabled,
})
useViewCyclingShortcuts(_currentProject)

// console.log("🚀 ~ file: [...boardURL].tsx:46 ~ currentProject:", projectSections) 



// ================== fetch Sections on server and pass down the component
      // ------- on favorites update
  useEffect(()=>{
    setFavorites(favoritesTQ)
  },[favoritesTQ])


// ================= update tab title
  useEffect(()=>{
    const builtinView = getBuiltinView(
      getActiveBoardViewId(_currentProject, activeBuiltinViews),
    );
    const savedView = getViewFromProject(_currentProject);
    const viewTitle =
      builtinView?.title ??
      (savedView?.type === "Default" ? undefined : savedView?.view.title);
    document.title = buildBoardDocumentTitle(_currentProject.title, viewTitle)
    // mixPageTrack({
    //   team_name: _currentProject.team.title,
    //   team_id: _currentProject.team.id,
    //   page: "Kanban"
    // })

  },[_currentProject, activeBuiltinViews])

useEffect(() => {

  setProjects(_allProjects)
  setCurrentProject(_allProjects[_projectIndex])
  setRecoilCurrentProject(_allProjects[_projectIndex])
  // setCurrentIndex(_projectIndex)

  setSections(_allProjects[_projectIndex].sections)

  // queryClient.refetchQueries({queryKey:["getAllTeamsMinimal"]})
}, [_allProjects])

// ================= detect horizontal scrollbar
useEffect(() => {
  const checkScrollbar = () => {
    if (kanbanContainerRef.current) {
      const hasScroll = kanbanContainerRef.current.scrollWidth > kanbanContainerRef.current.clientWidth;
      setHasHorizontalScrollbar(hasScroll);
    }
  };

  checkScrollbar();

  const resizeObserver = new ResizeObserver(() => {
    checkScrollbar();
  });

  if (kanbanContainerRef.current) {
    resizeObserver.observe(kanbanContainerRef.current);
  }

  window.addEventListener('resize', checkScrollbar);

  return () => {
    resizeObserver.disconnect();
    window.removeEventListener('resize', checkScrollbar);
  };
}, [sections, _currentProject]);

// ================= remember board horizontal scroll position across card navigation
useEffect(() => {
  const projectId = _currentProject?.id;
  if (!projectId) return;
  const key = `board-scroll-${projectId}`;

  const save = () => {
    // don't clobber the stored target while we're re-applying it
    if (restoringScroll.current) return;
    sessionStorage.setItem(key, JSON.stringify({
      c: kanbanContainerRef.current?.scrollLeft ?? 0,
      w: window.scrollX,
    }));
  };

  // restore once per project, but only after its columns have rendered.
  // The board can paint empty for a frame on remount, so re-apply across a
  // few animation frames until the scroller is wide enough for it to stick.
  if (restoredScrollForProject.current !== projectId && sections?.length) {
    restoredScrollForProject.current = projectId;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      try {
        const { c = 0, w = 0 } = JSON.parse(raw);
        restoringScroll.current = true;
        let tries = 0;
        const apply = () => {
          const box = kanbanContainerRef.current;
          if (box) box.scrollLeft = c;
          window.scrollTo(w, window.scrollY);
          const boxOk = !box || box.scrollLeft === c || box.scrollWidth - box.clientWidth <= c;
          const winOk = window.scrollX === w || document.documentElement.scrollWidth - window.innerWidth <= w;
          if ((!boxOk || !winOk) && tries++ < 20) requestAnimationFrame(apply);
          else restoringScroll.current = false;
        };
        requestAnimationFrame(apply);
      } catch { restoringScroll.current = false; }
    }
  }

  const el = kanbanContainerRef.current;
  el?.addEventListener('scroll', save, { passive: true });
  window.addEventListener('scroll', save, { passive: true });
  return () => {
    el?.removeEventListener('scroll', save);
    window.removeEventListener('scroll', save);
  };
}, [sections, _currentProject]);

function handleSideBar(){
  setShowBoardManager((prevState:boolean)=>!prevState);
}

// HTPR-3811: boards other than the active one load their tasks/allViews lazily on first
// open. Fetch (or reuse the prefetched side cache) + hydrate the target board
// LOCALLY. Must NOT write the ["projectsAll"] cache here: the outer board query
// (useGetAllBoards) subscribes to that key, so writing it re-renders the parent
// and resets this component's sections back to the initial board -> empty switch.
const ensureBoardLoaded = async (index:number):Promise<IProject|null> => {
  const target = projects[index]
  if (!target) return null
  if (isBoardPayloadHydrated(target)) return target // already hydrated
  try {
    const warm = queryClient.getQueryData(BOARD_TASKS_KEY(target.id, _currentUser.id))
    const boardPayload = isBoardTasksPayload(warm) ? warm : await fetchBoardTasks(target.id, _currentUser.id)
    queryClient.setQueryData(BOARD_TASKS_KEY(target.id, _currentUser.id), boardPayload) // keep side cache warm
    return hydrateBoardWithPayload(deepCopy(target), boardPayload)
  } catch (e) {
    console.error("Failed to load board data on switch", e)
    return null
  }
}

async function handleStateChangesOnBoardChange (index:number, saveBackSections?:ISection[]){
  const loaded = await ensureBoardLoaded(index);
  if (!loaded) return;
  const updatedProjects = deepCopy(projects);
  if (saveBackSections) updatedProjects[currentIndex].sections = saveBackSections;
  updatedProjects[index] = deepCopy(loaded);
  const deepCopiedSections = deepCopy(loaded.sections);
  setSections(deepCopiedSections )
  setProjects(updatedProjects)
  setCurrentProject(loaded)
  setRecoilCurrentProject(loaded)
  setCurrentIndex(index)
  goToProjectShortcut(loaded.id, true)
}


const handleBoardChange = (idx:number, sectionsFromCallback?:ISection[]) => {
  const favoritesindex = favorites?.findIndex(favorite=>favorite.index===idx)
  if (favoritesindex<0)return ;
  const index = projects.findIndex((project: { id: number; })=>project.id===favorites[favoritesindex].projectId)
  if (index < 0) return;
  markBoardSwitchIntent({ surface: "keyboard_shortcut", projectId: favorites[favoritesindex].projectId })
  // Save the current board's live sections back before switching, then switch.
  return handleStateChangesOnBoardChange(index, sectionsFromCallback ?? sections)
  }

const handleBoardChangeRef = useRef(handleBoardChange);
handleBoardChangeRef.current = handleBoardChange;

const debouncedHandleBoardChange = useMemo(
  () =>
    debounce((idx: number, sectionsFromCallback?: ISection[]) => {
      handleBoardChangeRef.current(idx, sectionsFromCallback);
    }, 50),
  []
);


// Render user datas
return (
  <>
  <div
     id="kanban-page-container"
     className={appShellRailOn ? `app-shell-rail-on ${showQuickTips ? "app-shell-quick-tips-on" : ""} flex flex-col gap-[16px] [overflow-anchor:none]` : " flex flex-col gap-[16px] [overflow-anchor:none]"}
    //  style={{height:'97.5svh'}}
     >
          <KanbanModalsProvider>
            {appShellRailOn ? (
              <Suspense fallback={<div className="h-[48px]" aria-label="Loading Board controls" />}>
                <AppShellRail
                  variant="board"
                  currentUser={_currentUser}
                  currentProject={_currentProject}
                  notificationsCount={_notifications.all}
                  notificationsUnseen={_notifications.unseen}
                />
                {showTrial && (
                  <Suspense fallback={null}>
                    <TrialModal closeCallback={() => setShowTrial(false)} />
                  </Suspense>
                )}
                {_currentProject && (
                  <div className="pills-row ml-[var(--app-shell-rail-w,48px)] flex w-[calc(100%-var(--app-shell-rail-w,48px))] shrink-0 items-start gap-3 pl-[calc(1.5%+9px)] pr-[1.5%] pt-4">
                    <div className="min-w-0 flex-1">
                      <ViewTabsBar project={_currentProject} forceShow appShellRail />
                    </div>
                    <ShellViewControls project={_currentProject} />
                    {/* Guest CTAs ride this existing row so they never push the
                        board down; the rail keeps its own copy. */}
                    <GuestAuthLinks />
                  </div>
                )}
              </Suspense>
            ) : isMbl ? (
              // Mobile runs the global app shell instead: MobileTopBar owns the
              // title, board/view switching and settings; the splits row and
              // tab bar own navigation. Spacing comes from the shell wrapper.
              null
            ) : (
              <Suspense fallback={<div className="h-[48px]" aria-label="Loading Board controls" />}>
                <div className="h-[48px] relative">
                  <Header
                    currentUser={_currentUser}
                    project={_currentProject}
                    notificationsCount={_notifications.all}
                    notificationsUnseen={_notifications.unseen}
                    currentProject={_currentProject}
                    members={_currentProject?.members}
                    owner={_currentProject?.owner}
                    openBoardManager={handleSideBar}
                  />
                </div>

                {_currentProject && <ViewTabsBar project={_currentProject} />}
              </Suspense>
            )}

          {_currentProject && (
            <CycleBoardMeta
              activeViewId={getActiveBoardViewId(
                _currentProject,
                activeBuiltinViews,
              )}
              project={_currentProject}
            />
          )}

          {/* {showBoardManager && <LeftSidebar teams={teams!} />} */}
          <div
            ref={kanbanContainerRef}
            id="kanban-sections-container"
            className={appShellRailOn
              ? 'bg-pageBackground homepage-container-tag ml-[var(--app-shell-rail-w,48px)] !w-[calc(100%-var(--app-shell-rail-w,48px))] flex-col gap-4 flex items-center'
              : 'bg-pageBackground homepage-container-tag flex-col gap-4 flex items-center'}
            >
            {boardLayout === "table" ? (
              <Suspense
                fallback={(
                  <div
                    aria-label="Loading table view"
                    className="min-h-[240px] w-full animate-pulse rounded-lg bg-gray-100/60 dark:bg-white/5"
                  />
                )}
              >
                <TableView
                  filteredSections={filteredSectionsForActiveView}
                  _sections={sections}
                  currentUser={_currentUser}
                  _currentProject={_currentProject}
                  _activeSortingMode={_activeSortingMode}
                  handleBoardChange={debouncedHandleBoardChange}
                />
              </Suspense>
            ) : (
            <HomePage
              filteredSections={filteredSectionsForActiveView}
              handleBoardChange={debouncedHandleBoardChange}
              _sections={sections}
              currentUser={_currentUser}
              _currentProject={_currentProject}
              _activeSortingMode={_activeSortingMode}
            />
            )}

          </div>
  
          </KanbanModalsProvider>
  </div>
    </>

);
}
