'use client'
import type { useLandingSectionState } from "./useLandingSectionState";
import { completeBoardReadinessTrace, emitBoardReadinessAfterPaint, markBoardReadinessPhase } from "@/lib/analytics/boardReadinessPhases";
import { resolveBoardSwitchIntent } from "@/lib/analytics/boardSwitchLatency";

import { useLandingSection } from "./LandingPageSection";
import type { SectionCompProps } from "./LandingPageSection";
import FirstScreenMobileChrome from "@/components/Global/FirstScreenMobileChrome";
import { useFirstScreenSurface } from "@/lib/firstScreen/SurfaceContext";
import BoardDocumentBoundary from "@/lib/firstScreen/BoardDocumentBoundary";
import { getBoardDocument } from "@/lib/firstScreen/boardDocument";
import type { LandingPageInput } from "./LandingPageShared";


import { BoardRenderSnapshot, EMPTY_NOTIFICATION_COUNT, useCommittedBoardReadinessTrace, AppShellRail, TrialModal, ViewTabsBar, ShellViewControls, GuestAuthLinks, Header, TableView } from "./LandingPageShared";
export { type LandingPageInput } from "./LandingPageShared";

import nookies from "nookies"
import { IProject, IProjectsAll, IUser } from "@/models/model";

import { useFlag } from "@/hooks/useFlag";
import { HTPR_7028_FIRST_TASK_EMAIL_FLAG, HTPR_7078_REMOVE_CONNECT_BLOCK_FLAG } from "@/lib/flags/keys";
import { CommandMode } from "@/models/enums";
import { showCommandsAtom, currentProjectAtom, boardLayoutAtom, boardLayoutPreferenceAtom, showAIChatInterfaceAtom, openAiChatByDefaultAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom } from "@/store";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";



import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ActiveBoardPayloadUnavailableError, PROJECTS_ALL_QUERY_KEY, purgeRevokedBoardTaskQueries, isRevocationStillActiveBoard, normalizeRequestedProjectId, type ProjectsAuthorizationContext, revokeBoardAccess, useGetAllBoards } from "@/hooks/Homepage/useGetBoards";
import { useGetNotificationCount } from "@/hooks/Inbox/useGetNotifications";
import { useQueryClient } from "@tanstack/react-query";

import HomePage from "@/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage";
import { AgentConnectCard } from "@/components/PageComponents/Onboarding/AgentConnectCard";
import { KanbanModalsProvider } from "@/lib/contexts/Kanban/KanbanContainer/KanbanModalContext";

import { addLastActivityAt } from "@/utils/api/helperFunctions";
import { BOARD_TASKS_KEY, fetchBoardTasks, hydrateBoardWithPayload, isBoardPayloadHydrated, isBoardTasksPayload } from "@/utils/api/Homepage";

import { MOBILE_BOARD_SWITCHER_QUERY_KEY } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import { getActiveBoardLayoutPreferenceFromProject, getActiveSortingModeFromProject, getViewFromProject, pinProjectToUrlView, resolveBoardLayoutFromSurface } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TBoardSortingViewMode } from "@/models/Views/model";

import { useDeferredSubscriptionCheck } from "@/hooks/General/useDeferredSubscriptionCheck";
import { useHydrated } from "@/hooks/General/useHydrated";

import { MobileViewContext } from "@/lib/contexts/mobileContext";

import { isGuestUser } from "@/lib/demo/guest";
import NoBoardsEmptyState from "./NoBoardsEmptyState";



import { getActiveBoardViewId } from "@/lib/constants/builtinViews";

import CycleBoardMeta from "@/components/PageComponents/Kanban/HeaderComponents/CycleBoardMeta";

import { type BoardAuthorizationProof, usePreparedBoardReadModel, useSyncedBoardReadModel } from "@/hooks/Homepage/useSyncedBoardReadModel";
import { getBoardSyncPilotEnabled, persistBoardSyncPilotPreference } from "@/lib/boardSync/pilot";
import { useBoardStartup } from "@/lib/contexts/boardStartupContext";
import { discardEarlyBoardBootstrap } from "@/lib/boardBootstrap/earlyBoardBootstrap";

import { createBoardReadinessRouteEntryId, flushBoardReadinessTrace, markBoardNetworkQueryPublished } from "@/lib/analytics/boardReadinessPhases";

import { getNextRouterAwareHistoryState } from "@/lib/navigation/nextHistoryState";
import { shouldReleaseSecondaryStartupForTerminalBoard, shouldReleaseSecondaryStartupOnBoardRequest } from "@/lib/boardStartup/secondaryRequests";
import { clearRevokedBoardMarker, clearRevokedBoardReadModel } from "@/lib/localReadModels/clear";


type useLandingBoardAccessContext = Pick<LandingPageInput, "slugsProp" | "user">;


export function useLandingBoardAccess(context: useLandingBoardAccessContext) {
  const {
  slugsProp, user,
  } = context;


const queryClient = useQueryClient();
const setRouteCurrentProject = useSetRecoilState(currentProjectAtom)
const router = useRouter()
const {
  releaseSecondaryStartup,
  secondaryStartupEnabled,
} = useBoardStartup();
const isMblForChat = useContext(MobileViewContext)
const searchParams = useSearchParams()
const routedProjectId = normalizeRequestedProjectId(searchParams?.get("id"))
const slugs = routedProjectId !== null
  ? String(routedProjectId)
  : slugsProp
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
const document = getBoardDocument(useFirstScreenSurface(user.id), user.id, requestedProjectId);
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
}>({ key: boardAccessKey, status: document ? "authorized" : "pending" })
const [networkAccess, setNetworkAccess] = useState<{
  key: string;
  generation: number;
  requestId: string | null;
}>({
  key: boardAccessKey,
  generation: 0,
  requestId: document?.scope.generation ?? null,
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
    const localData = queryClient.getQueryData<IProjectsAll>(
      PROJECTS_ALL_QUERY_KEY,
    )
    const localProject =
      localData?.accountId === publishedAccountId &&
      localData.dataOrigin === "indexeddb"
        ? localData.updatedProjects.find(
            (project) => project.id === publishedProjectId,
          )
        : undefined
    if (!localProject) return
    // Publish the authorized project atom in the same React batch as access.
    // SectionComp then reconciles the target once with matching global state.
    setRouteCurrentProject(pinProjectToUrlView(localProject, currentView))
    setBoardAccess((current) =>
      current.key === boardAccessKey &&
      (current.status === "authorized" || current.status === "denied")
        ? current
        : { key: boardAccessKey, status: "local" },
    )
  },
  [
    boardAccessKey,
    currentView,
    queryClient,
    requestedProjectId,
    setRouteCurrentProject,
    user.id,
  ],
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
  return {
  queryClient, router, releaseSecondaryStartup, secondaryStartupEnabled, isMblForChat,
  searchParams, slugs, pilotParameter, currentView, requestedSurface,
  surfaceInitializationKey, surfaceInitializedFor, setSurfaceInitializedFor, surfaceResolutionRef, pendingProgrammaticSurfaceRef,
  requestedProjectId, isGuest, boardAccessKey, readinessRouteEntryId, readinessTraceScope,
  boardAccess, setBoardAccess, networkAccess, setNetworkAccess, setSyncedBoardPilotEnabled,
  pilotPreferenceResolved, setPilotPreferenceResolved, localDatabasePilotEnabled, pilotExplicitlyDisabled, boardLayout,
  setBoardLayout, lastObservedBoardLayoutRef, userSurfaceChangeVersionRef, boardLayoutPreference, cancelPreparedLocalPublication,
  latestBoardAuthorizationProofRef, publishedAuthorizationKeyRef, publishAuthorizedLocalBoard, revokeActiveBoard,
  };
}



type useLandingBoardQueryContext = Pick<LandingPageInput, "user"> &
  Pick<ReturnType<typeof useLandingBoardAccess>, "slugs" | "requestedProjectId" | "latestBoardAuthorizationProofRef" | "pilotExplicitlyDisabled" | "setNetworkAccess" | "boardAccessKey" | "localDatabasePilotEnabled" | "setBoardAccess" | "publishAuthorizedLocalBoard" | "revokeActiveBoard" | "queryClient" | "cancelPreparedLocalPublication" | "isMblForChat" | "releaseSecondaryStartup" | "secondaryStartupEnabled" | "boardAccess" | "networkAccess" | "readinessTraceScope">;


export function useLandingBoardQuery(context: useLandingBoardQueryContext) {
  const {
  user, slugs, requestedProjectId, latestBoardAuthorizationProofRef, pilotExplicitlyDisabled,
  setNetworkAccess, boardAccessKey, localDatabasePilotEnabled, setBoardAccess, publishAuthorizedLocalBoard,
  revokeActiveBoard, queryClient, cancelPreparedLocalPublication, isMblForChat, releaseSecondaryStartup,
  secondaryStartupEnabled, boardAccess, networkAccess, readinessTraceScope,
  } = context;

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
// Read the cache first: local publication writes it before its access callback,
// so that callback's React batch can render the target without waiting for the
// query observer's scheduled notification.
const cachedQueryData =
  queryClient.getQueryData<IProjectsAll>(PROJECTS_ALL_QUERY_KEY)
const queryData: IProjectsAll | undefined =
  cachedQueryData?.accountId === user.id ? cachedQueryData : fetchedData;
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
  return {
  fetchedData, dataFetching, projectsError, refetchProjects, notificationCount,
  currentBoardAccessStatus, queryData, data, hasAccountOwnedNetworkData,
  };
}



type useLandingBoardSurfaceContext = Pick<LandingPageInput, "user"> &
  Pick<ReturnType<typeof useLandingBoardAccess>, "setBoardAccess" | "boardAccessKey" | "setNetworkAccess" | "pilotParameter" | "setSyncedBoardPilotEnabled" | "setPilotPreferenceResolved" | "pilotPreferenceResolved" | "pilotExplicitlyDisabled" | "latestBoardAuthorizationProofRef" | "publishedAuthorizationKeyRef" | "localDatabasePilotEnabled" | "queryClient" | "requestedProjectId" | "slugs" | "isMblForChat" | "releaseSecondaryStartup" | "currentView" | "surfaceResolutionRef" | "surfaceInitializationKey" | "requestedSurface" | "boardLayoutPreference" | "boardLayout"> &
  Pick<ReturnType<typeof useLandingBoardQuery>, "refetchProjects" | "currentBoardAccessStatus" | "fetchedData" | "hasAccountOwnedNetworkData" | "dataFetching" | "projectsError" | "data" | "queryData">;


export function useLandingBoardSurface(context: useLandingBoardSurfaceContext) {
  const {
  setBoardAccess, boardAccessKey, setNetworkAccess, pilotParameter, setSyncedBoardPilotEnabled,
  setPilotPreferenceResolved, pilotPreferenceResolved, pilotExplicitlyDisabled, latestBoardAuthorizationProofRef, publishedAuthorizationKeyRef,
  refetchProjects, localDatabasePilotEnabled, queryClient, user, requestedProjectId,
  currentBoardAccessStatus, fetchedData, hasAccountOwnedNetworkData, dataFetching, projectsError,
  data, slugs, isMblForChat, queryData, releaseSecondaryStartup,
  currentView, surfaceResolutionRef, surfaceInitializationKey, requestedSurface, boardLayoutPreference,
  boardLayout,
  } = context;

const pathname = usePathname()
const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom)
const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom)
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
const boardLayoutForRender =
  pinnedProject &&
  surfaceResolutionRef.current?.key !== surfaceInitializationKey
    ? resolveBoardLayoutFromSurface(
        requestedSurface,
        getActiveBoardLayoutPreferenceFromProject(pinnedProject),
        boardLayoutPreference,
      )
    : boardLayout
  return {
  pathname, setShowAiChatInterface, setAiChatExplicitOpenAt, openAiChatByDefault, aiChatAutoOpenSuppressed,
  aiChatPinned, welcomeAiHandledRef, hydratingRef, hydrationRetryAttemptsRef, hydrationRetryToken,
  setHydrationRetryToken, hydrationFailedProjectId, setHydrationFailedProjectId, projectLookupFailed, setProjectLookupFailed,
  projectIndex, projectsForSection, pinnedProject, boardLayoutForRender,
  };
}



type useLandingBoardHydrationContext = Pick<LandingPageInput, "user"> &
  Pick<ReturnType<typeof useLandingBoardAccess>, "isMblForChat" | "isGuest" | "slugs" | "surfaceResolutionRef" | "lastObservedBoardLayoutRef" | "boardLayout" | "pendingProgrammaticSurfaceRef" | "surfaceInitializationKey" | "userSurfaceChangeVersionRef" | "requestedSurface" | "boardLayoutPreference" | "setBoardLayout" | "setSurfaceInitializedFor" | "searchParams" | "surfaceInitializedFor" | "currentView" | "router" | "queryClient"> &
  Pick<ReturnType<typeof useLandingBoardSurface>, "aiChatPinned" | "openAiChatByDefault" | "aiChatAutoOpenSuppressed" | "setShowAiChatInterface" | "pinnedProject" | "projectIndex" | "hydrationFailedProjectId" | "welcomeAiHandledRef" | "setAiChatExplicitOpenAt" | "pathname" | "setProjectLookupFailed" | "hydrationRetryAttemptsRef" | "setHydrationFailedProjectId" | "hydratingRef" | "setHydrationRetryToken" | "hydrationRetryToken"> &
  Pick<ReturnType<typeof useLandingBoardQuery>, "data" | "dataFetching" | "refetchProjects">;


export function useLandingBoardHydration(context: useLandingBoardHydrationContext) {
  const {
  isMblForChat, isGuest, aiChatPinned, openAiChatByDefault, aiChatAutoOpenSuppressed,
  setShowAiChatInterface, slugs, pinnedProject, data, surfaceResolutionRef,
  lastObservedBoardLayoutRef, boardLayout, pendingProgrammaticSurfaceRef, surfaceInitializationKey, userSurfaceChangeVersionRef,
  requestedSurface, boardLayoutPreference, setBoardLayout, setSurfaceInitializedFor, searchParams,
  surfaceInitializedFor, projectIndex, hydrationFailedProjectId, dataFetching, welcomeAiHandledRef,
  setAiChatExplicitOpenAt, currentView, pathname, router, refetchProjects,
  setProjectLookupFailed, user, hydrationRetryAttemptsRef, setHydrationFailedProjectId, hydratingRef,
  queryClient, setHydrationRetryToken, hydrationRetryToken,
  } = context;
  const hydrated = useHydrated()
  const setAiChatAutoOpenSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom)


// Pinning always opens chat. Otherwise, the default setting opens it unless
// a manual close suppressed auto-open or the board is shown on mobile.
useEffect(() => {
  // The state adapter exposes SSR defaults until this consumer has hydrated.
  if (
    !hydrated ||
    isMblForChat ||
    (!isGuest &&
      !aiChatPinned &&
      (!openAiChatByDefault || aiChatAutoOpenSuppressed))
  ) return;
  setShowAiChatInterface(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  hydrated,
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
  // A cold cached open keeps this board mounted until the viewer chunk is ready.
  if (window.location.pathname.startsWith("/detail/") && window.history.state?.cachedTaskDetail) return;
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
    // A welcome link is an explicit ask for the chat; focus the composer.
    setAiChatAutoOpenSuppressed(false);
    setAiChatExplicitOpenAt(Date.now());
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
    if (pathname === "/project") {
      window.history.replaceState(
        getNextRouterAwareHistoryState(window.history.state),
        "",
        newUrl,
      )
    } else {
      router.replace(newUrl, { scroll: false });
    }
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
  return {
  retryBoardHydration, activeSortingMode,
  };
}



const  LandingPage= ({
  user,
  authenticated,
  slugs: slugsProp
    }: {
  slugs:any,
  user: IUser,
  authenticated: boolean,
}) =>{
  const {
  queryClient, router, releaseSecondaryStartup, secondaryStartupEnabled, isMblForChat,
  searchParams, slugs, pilotParameter, currentView, requestedSurface,
  surfaceInitializationKey, surfaceInitializedFor, setSurfaceInitializedFor, surfaceResolutionRef, pendingProgrammaticSurfaceRef,
  requestedProjectId, isGuest, boardAccessKey, readinessRouteEntryId, readinessTraceScope,
  boardAccess, setBoardAccess, networkAccess, setNetworkAccess, setSyncedBoardPilotEnabled,
  pilotPreferenceResolved, setPilotPreferenceResolved, localDatabasePilotEnabled, pilotExplicitlyDisabled, boardLayout,
  setBoardLayout, lastObservedBoardLayoutRef, userSurfaceChangeVersionRef, boardLayoutPreference, cancelPreparedLocalPublication,
  latestBoardAuthorizationProofRef, publishedAuthorizationKeyRef, publishAuthorizedLocalBoard, revokeActiveBoard,
  } = useLandingBoardAccess({
    slugsProp, user,
  });
  const {
  fetchedData, dataFetching, projectsError, refetchProjects, notificationCount,
  currentBoardAccessStatus, queryData, data, hasAccountOwnedNetworkData,
  } = useLandingBoardQuery({
    user, slugs, requestedProjectId, latestBoardAuthorizationProofRef, pilotExplicitlyDisabled,
    setNetworkAccess, boardAccessKey, localDatabasePilotEnabled, setBoardAccess, publishAuthorizedLocalBoard,
    revokeActiveBoard, queryClient, cancelPreparedLocalPublication, isMblForChat, releaseSecondaryStartup,
    secondaryStartupEnabled, boardAccess, networkAccess, readinessTraceScope,
  });
  const {
  pathname, setShowAiChatInterface, setAiChatExplicitOpenAt, openAiChatByDefault, aiChatAutoOpenSuppressed,
  aiChatPinned, welcomeAiHandledRef, hydratingRef, hydrationRetryAttemptsRef, hydrationRetryToken,
  setHydrationRetryToken, hydrationFailedProjectId, setHydrationFailedProjectId, projectLookupFailed, setProjectLookupFailed,
  projectIndex, projectsForSection, pinnedProject, boardLayoutForRender,
  } = useLandingBoardSurface({
    setBoardAccess, boardAccessKey, setNetworkAccess, pilotParameter, setSyncedBoardPilotEnabled,
    setPilotPreferenceResolved, pilotPreferenceResolved, pilotExplicitlyDisabled, latestBoardAuthorizationProofRef, publishedAuthorizationKeyRef,
    refetchProjects, localDatabasePilotEnabled, queryClient, user, requestedProjectId,
    currentBoardAccessStatus, fetchedData, hasAccountOwnedNetworkData, dataFetching, projectsError,
    data, slugs, isMblForChat, queryData, releaseSecondaryStartup,
    currentView, surfaceResolutionRef, surfaceInitializationKey, requestedSurface, boardLayoutPreference,
    boardLayout,
  });
  const {
  retryBoardHydration, activeSortingMode,
  } = useLandingBoardHydration({
    isMblForChat, isGuest, aiChatPinned, openAiChatByDefault, aiChatAutoOpenSuppressed,
    setShowAiChatInterface, slugs, pinnedProject, data, surfaceResolutionRef,
    lastObservedBoardLayoutRef, boardLayout, pendingProgrammaticSurfaceRef, surfaceInitializationKey, userSurfaceChangeVersionRef,
    requestedSurface, boardLayoutPreference, setBoardLayout, setSurfaceInitializedFor, searchParams,
    surfaceInitializedFor, projectIndex, hydrationFailedProjectId, dataFetching, welcomeAiHandledRef,
    setAiChatExplicitOpenAt, currentView, pathname, router, refetchProjects,
    setProjectLookupFailed, user, hydrationRetryAttemptsRef, setHydrationFailedProjectId, hydratingRef,
    queryClient, setHydrationRetryToken, hydrationRetryToken,
  });

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

const readyProject = data?.updatedProjects?.[projectIndex]
const boardDataReady = Boolean(
  readyProject && isBoardPayloadHydrated(readyProject),
)
const firstTaskEmailEnabled = useFlag(HTPR_7028_FIRST_TASK_EMAIL_FLAG)
const inviteRequested = firstTaskEmailEnabled ? searchParams?.get("invite") === "1" : false
const setShowCommands = useSetRecoilState(showCommandsAtom)
const inviteProject = useRecoilValue(currentProjectAtom)
const inviteHandledRef = useRef<string | null>(null)
useEffect(() => {
  if (!inviteRequested) {
    inviteHandledRef.current = null;
    return;
  }
  if (!authenticated || isGuest || !boardDataReady ||
      currentBoardAccessStatus !== "authorized" || readyProject?.id !== requestedProjectId ||
      inviteProject?.id !== requestedProjectId) return;
  const key = `${user.id}:${requestedProjectId}`;
  if (inviteHandledRef.current === key) return;
  inviteHandledRef.current = key;
  setShowCommands({ show: true, mode: CommandMode.InviteMember });
  const url = new URL(window.location.href);
  url.searchParams.delete("invite");
  window.history.replaceState(getNextRouterAwareHistoryState(window.history.state), "", `${url.pathname}${url.search}${url.hash}`);
}, [inviteRequested, authenticated, isGuest, boardDataReady, currentBoardAccessStatus, readyProject?.id, requestedProjectId, inviteProject?.id, user.id, setShowCommands])
const readyBoardRender = useMemo<BoardRenderSnapshot | null>(
  () =>
    boardDataReady && readyProject
      ? {
          accountId: user.id,
          projects: projectsForSection,
          projectIndex,
          activeSortingMode,
          boardLayout: boardLayoutForRender,
          readinessSource: data?.dataOrigin ?? "unknown",
          readinessProjectId: readyProject.id,
          readinessRouteEntryId,
        }
      : null,
  [
    activeSortingMode,
    boardDataReady,
    boardLayoutForRender,
    data?.dataOrigin,
    projectIndex,
    projectsForSection,
    readinessRouteEntryId,
    readyProject,
    user.id,
  ],
)
const committedBoardRenderRef = useRef<BoardRenderSnapshot | null>(null)
useLayoutEffect(() => {
  if (readyBoardRender) committedBoardRenderRef.current = readyBoardRender
}, [readyBoardRender])
const committedBoardRender = committedBoardRenderRef.current
const boardRender =
  readyBoardRender ??
  (committedBoardRender?.accountId === user.id &&
    currentBoardAccessStatus !== "denied" &&
    !projectLookupFailed &&
    hydrationFailedProjectId !== requestedProjectId
      ? committedBoardRender
      : null)

return (
    <BoardDocumentBoundary fallback={<></>}>
      <FirstScreenMobileChrome currentUser={user} />

      {data &&
      Array.isArray(data.updatedProjects) &&
      data.updatedProjects.length === 0 ? (
        <NoBoardsEmptyState user={user} />
      ) : boardRender ? (
           <SectionComp
            _allProjects={boardRender.projects}
            _projectCount={boardRender.projects.length}
            _currentUser={user}
            _notifications={notificationCount ?? EMPTY_NOTIFICATION_COUNT}
            _projectIndex={boardRender.projectIndex}
            _activeSortingMode={boardRender.activeSortingMode}
            _authenticated={authenticated && !isGuest}
            _localDatabasePilotEnabled={localDatabasePilotEnabled}
            _boardLayout={boardRender.boardLayout}
            _readinessSource={boardRender.readinessSource}
            _readinessProjectId={boardRender.readinessProjectId}
            _readinessRouteEntryId={boardRender.readinessRouteEntryId}
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
    </BoardDocumentBoundary>
)

}

export default LandingPage

const SectionComp = (props: SectionCompProps) => {
  return renderLandingSection(useLandingSection(props, useLandingSectionReadiness));
};

function renderLandingSection(context: ReturnType<typeof useLandingSection>) {
  const connectBlockRemoved = useFlag(HTPR_7078_REMOVE_CONNECT_BLOCK_FLAG)
  const {
  boardLayout, isMbl, appShellRailOn, showQuickTips, _currentProject,
  sections, setShowTrial, showTrial, activeBuiltinViews, filteredSectionsForActiveView,
  kanbanContainerRef, handleSideBar, handleBoardChange, debouncedHandleBoardChange, _notifications,
  _currentUser, _activeSortingMode,
  } = context;



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
              <BoardDocumentBoundary fallback={<div className="h-[56px] shrink-0" aria-label="Loading Board controls" />}>
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
              </BoardDocumentBoundary>
            ) : isMbl ? (
              // Mobile runs the global app shell instead: MobileTopBar owns the
              // title, board/view switching and settings; the splits row and
              // tab bar own navigation. Spacing comes from the shell wrapper.
              null
            ) : (
              <BoardDocumentBoundary fallback={<div className="h-[48px]" aria-label="Loading Board controls" />}>
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
              </BoardDocumentBoundary>
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
            {!connectBlockRemoved && _currentProject && _currentUser?.id && (
              <AgentConnectCard projectId={_currentProject.id} userId={_currentUser.id} />
            )}
            {boardLayout === "table" ? (
              <BoardDocumentBoundary
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
              </BoardDocumentBoundary>
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

export function useLandingSectionReadiness(context: Pick<SectionCompProps & ReturnType<typeof useLandingSectionState> & { boardReadinessTraceScope: ReturnType<typeof useCommittedBoardReadinessTrace> }, "boardReadinessTraceScope" | "_currentProject" | "_allProjects" | "_projectIndex" | "readinessCompletionRef" | "readinessFrameRef" | "readinessPaintFrameRef" | "markBoardUsable" | "releaseSecondaryStartup" | "readinessEntryKey">) {
  const {
  boardReadinessTraceScope, _currentProject, _allProjects, _projectIndex, readinessCompletionRef,
  readinessFrameRef, readinessPaintFrameRef, markBoardUsable, releaseSecondaryStartup, readinessEntryKey,
  } = context;


useLayoutEffect(() => {
  if (!boardReadinessTraceScope) return;
  // HTPR-6072: belt-and-suspenders on top of the useLayoutEffect re-sync
  // above - a readiness sample must never be taken while local state (the
  // currentProject this render actually used) still lags the routed
  // project. If they disagree, this frame is transitional; skip it rather
  // than mark or complete a trace against it.
  if (_currentProject?.id !== _allProjects[_projectIndex]?.id) return;
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
}
