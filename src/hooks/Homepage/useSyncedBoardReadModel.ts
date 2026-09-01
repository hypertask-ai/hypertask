import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { IProjectsAll } from "@/models/model";
import type { BoardSyncPayloadV1 } from "@/lib/boardSync/contract";
import {
  hydrateBoardWithPayload,
  isBoardPayloadHydrated,
} from "@/utils/api/Homepage";
import { PROJECTS_ALL_QUERY_KEY } from "./useGetBoards";
import { isBoardRevocationTombstoned } from "@/lib/boardSync/revocationTombstone";
import { hasBoardReadModelMarker } from "@/lib/boardSync/readModelMarker";
import {
  type BoardReadinessTraceScope,
  getBoardReadinessTraceScope,
  markBoardReadinessPhase,
} from "@/lib/analytics/boardReadinessPhases";

type ProjectsAllWithIndex = IProjectsAll & { index?: number };

type AuthorizedLocalPublication = {
  projectsData: ProjectsAllWithIndex;
};

export type BoardAuthorizationProof = {
  accountId: number;
  projectId: number;
  authorizedProjectIds: number[];
  generation: number;
  requestId: string;
  queryUpdateCountAtAuthorization: number;
  isCurrent: () => boolean;
};

export const isBoardAuthorizationProofCurrent = ({
  proof,
  accountId,
  projectId,
}: {
  proof: BoardAuthorizationProof;
  accountId: number;
  projectId: number | null;
}): boolean =>
  projectId != null &&
  proof.isCurrent() &&
  proof.accountId === accountId &&
  proof.projectId === projectId &&
  proof.authorizedProjectIds.includes(projectId);

export const didNetworkResultPublishAfterAuthorization = ({
  updateCountAtAuthorization,
  currentUpdateCount,
  current,
  accountId,
}: {
  updateCountAtAuthorization: number;
  currentUpdateCount: number;
  current?: ProjectsAllWithIndex;
  accountId: number;
}): boolean =>
  currentUpdateCount > updateCountAtAuthorization &&
  current?.accountId === accountId &&
  current.dataOrigin === "network";

export const buildAuthorizedLocalPublication = ({
  accountId,
  projectId,
  authorizedProjectIds,
  current,
  payload,
}: {
  accountId: number;
  projectId: number;
  authorizedProjectIds: number[];
  current?: ProjectsAllWithIndex;
  payload: BoardSyncPayloadV1;
}): AuthorizedLocalPublication | null => {
  if (
    !authorizedProjectIds.includes(projectId) ||
    payload.project.id !== projectId
  ) {
    return null;
  }

  const ownedCurrent = current?.accountId === accountId ? current : undefined;
  const authorizedCurrentProjects = ownedCurrent?.updatedProjects?.filter(
    (project) => authorizedProjectIds.includes(project.id),
  );
  const currentIndex =
    authorizedCurrentProjects?.findIndex(
      (project) => project.id === projectId,
    ) ?? -1;
  if (
    currentIndex >= 0 &&
    isBoardPayloadHydrated(authorizedCurrentProjects![currentIndex]) &&
    ownedCurrent?.dataOrigin !== "network"
  ) {
    return {
      projectsData: {
        ...ownedCurrent,
        accountId,
        dataOrigin: "indexeddb",
        index: currentIndex,
        updatedProjects: authorizedCurrentProjects!,
        notificationsCount: ownedCurrent?.notificationsCount ?? {
          all: 0,
          unseen: 0,
        },
      },
    };
  }

  // Network cache present before this authorization is only display history.
  // The caller's update-count guard has already stopped any newer network
  // publication, so let the freshly authorized local payload replace it.

  const existingProject =
    currentIndex >= 0 ? authorizedCurrentProjects![currentIndex] : undefined;
  const baseProject = existingProject
    ? { ...payload.project, ...existingProject }
    : payload.project;
  const hydratedProject = hydrateBoardWithPayload(baseProject, {
    ...payload,
    project: baseProject,
  });
  const updatedProjects = authorizedCurrentProjects
    ? [...authorizedCurrentProjects]
    : [];
  if (currentIndex >= 0) updatedProjects[currentIndex] = hydratedProject;
  else updatedProjects.push(hydratedProject);

  const index = currentIndex >= 0 ? currentIndex : updatedProjects.length - 1;
  return {
    projectsData: {
      ...ownedCurrent,
      accountId,
      dataOrigin: "indexeddb",
      index,
      updatedProjects,
      notificationsCount: ownedCurrent?.notificationsCount ?? {
        all: 0,
        unseen: 0,
      },
    },
  };
};

type LocalBoardPublicationScope = {
  activeKey: string | null;
  enabled: boolean;
  accountId: number;
  projectId: number | null;
};

export const publishPreparedLocalBoard = async ({
  proof,
  prepareLocalRead,
  getCurrentScope,
  queryClient,
  claimPublication,
  onPublished,
}: {
  proof: BoardAuthorizationProof;
  prepareLocalRead: () => Promise<BoardSyncPayloadV1 | null>;
  getCurrentScope: () => LocalBoardPublicationScope;
  queryClient: QueryClient;
  claimPublication: (activeKey: string) => boolean;
  onPublished?: (publication: AuthorizedLocalPublication) => void;
}): Promise<boolean> => {
  const startingScope = getCurrentScope();
  if (
    !startingScope.activeKey ||
    !startingScope.enabled ||
    !isBoardAuthorizationProofCurrent({
      proof,
      accountId: startingScope.accountId,
      projectId: startingScope.projectId,
    }) ||
    // A revocation whose IndexedDB deletion failed leaves the snapshot on
    // disk. It must never paint again until the delete succeeds or the
    // network authorizes this board afresh.
    isBoardRevocationTombstoned(startingScope.accountId, proof.projectId)
  ) {
    return false;
  }

  const authorizedKey = startingScope.activeKey;
  const payload = await prepareLocalRead();
  const currentScope = getCurrentScope();
  if (
    currentScope.activeKey !== authorizedKey ||
    !currentScope.enabled ||
    !isBoardAuthorizationProofCurrent({
      proof,
      accountId: currentScope.accountId,
      projectId: currentScope.projectId,
    }) ||
    !payload ||
    // Revocation tombstones the entry only after its delete attempts settle,
    // which can land while this read is still in flight.
    isBoardRevocationTombstoned(currentScope.accountId, proof.projectId)
  ) {
    return false;
  }

  const currentCache = queryClient.getQueryData<ProjectsAllWithIndex>(
    PROJECTS_ALL_QUERY_KEY,
  );
  const currentUpdateCount =
    queryClient.getQueryState<ProjectsAllWithIndex>(PROJECTS_ALL_QUERY_KEY)
      ?.dataUpdateCount ?? 0;
  if (
    didNetworkResultPublishAfterAuthorization({
      updateCountAtAuthorization: proof.queryUpdateCountAtAuthorization,
      currentUpdateCount,
      current: currentCache,
      accountId: currentScope.accountId,
    })
  ) {
    return false;
  }

  const publication = buildAuthorizedLocalPublication({
    accountId: currentScope.accountId,
    projectId: proof.projectId,
    authorizedProjectIds: proof.authorizedProjectIds,
    current: currentCache,
    payload,
  });
  if (!publication) return false;
  // A second proof for the same route still has an available local fallback.
  // Report success without writing again so transient board-payload failures
  // keep the already-painted snapshot on screen.
  if (!claimPublication(authorizedKey)) return true;

  queryClient.setQueryData(
    PROJECTS_ALL_QUERY_KEY,
    publication.projectsData,
    // The local snapshot is display data, not a reusable authorization result.
    // Keep it stale so it can never suppress a later network proof.
    { updatedAt: 0 },
  );
  onPublished?.(publication);
  return true;
};

export const usePreparedBoardReadModel = ({
  enabled,
  accountId,
  projectId,
  viewSurface,
  queryClient,
  onLocalBoardPublished,
}: {
  enabled: boolean;
  accountId: number;
  projectId: number | null;
  viewSurface: "board" | "table";
  queryClient: QueryClient;
  onLocalBoardPublished?: (accountId: number, projectId: number) => void;
}) => {
  // Deliberately exclude viewSurface. An in-place Board/Table toggle reuses
  // already-published project data and is not an IndexedDB route restore.
  // Including it would mix near-zero toggles into cold-entry readiness and let
  // a later focus refresh restart the long-lived timer this metric is fixing.
  const activeKey =
    enabled && accountId > 0 && projectId != null
      ? `${accountId}:${projectId}`
      : null;
  const runtimeRef = useRef({
    activeKey,
    enabled,
    accountId,
    projectId,
    viewSurface,
    onLocalBoardPublished,
  });
  useLayoutEffect(() => {
    runtimeRef.current = {
      activeKey,
      enabled,
      accountId,
      projectId,
      viewSurface,
      onLocalBoardPublished,
    };
  }, [
    accountId,
    activeKey,
    enabled,
    onLocalBoardPublished,
    projectId,
    viewSurface,
  ]);
  const localProofGenerationRef = useRef(0);
  const publishedLocalKeyRef = useRef<string | null>(null);
  const preparedRef = useRef<{
    key: string;
    promise: Promise<BoardSyncPayloadV1 | null>;
    traceScope: BoardReadinessTraceScope | null;
  } | null>(null);

  const prepareLocalRead = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime.activeKey || !runtime.enabled || runtime.projectId == null) {
      return Promise.resolve(null);
    }
    if (preparedRef.current?.key === runtime.activeKey) {
      return preparedRef.current.promise;
    }

    const preparedKey = runtime.activeKey;
    const preparedAccountId = runtime.accountId;
    const preparedProjectId = runtime.projectId;
    const traceScope = getBoardReadinessTraceScope();
    markBoardReadinessPhase("localReadStart", traceScope);
    const promise = (async () => {
      // HTPR-5927: no marker means no snapshot has ever been written in this
      // browser, so there is nothing IndexedDB can offer -- skip both the
      // databases() enumeration and the keyed open, and let the network path
      // run alone (same as the /speed lab's "without local DB" variant on a
      // first-ever visit). A marker just means "may exist" -- the keyed open
      // below already handles a false positive (cleared store, stale marker)
      // the same way it always has: it finds nothing and returns null.
      if (!hasBoardReadModelMarker()) return null;
      const { readBoardReadModel } =
        await import("@/lib/boardSync/indexedDbReadModel");
      return readBoardReadModel(preparedAccountId, preparedProjectId);
    })()
      .catch(() => null)
      .finally(() => {
        if (runtimeRef.current.activeKey === preparedKey) {
          markBoardReadinessPhase("localReadFinish", traceScope);
        }
      });
    preparedRef.current = { key: preparedKey, promise, traceScope };
    return promise;
  }, []);

  const authorizeAndPublishLocalBoard = useCallback(
    (proof: BoardAuthorizationProof) =>
      publishPreparedLocalBoard({
        proof,
        prepareLocalRead,
        getCurrentScope: () => runtimeRef.current,
        queryClient,
        claimPublication: (publicationKey) => {
          if (publishedLocalKeyRef.current === publicationKey) return false;
          publishedLocalKeyRef.current = publicationKey;
          return true;
        },
        onPublished: () => {
          const traceScope =
            preparedRef.current?.key === runtimeRef.current.activeKey
              ? preparedRef.current.traceScope
              : null;
          markBoardReadinessPhase("queryPublished", traceScope);
        },
      }),
    [prepareLocalRead, queryClient],
  );

  // Start the account-scoped read before React Query subscribes. A matching
  // snapshot publishes as soon as IndexedDB resolves. Network authorization
  // still runs and can revoke this display-only proof.
  useLayoutEffect(() => {
    const generation = ++localProofGenerationRef.current;
    // Route re-entry gets a fresh publication claim. Keeping the previous key
    // would refuse the new entry's write and report success with nothing
    // published.
    publishedLocalKeyRef.current = null;
    if (!activeKey) {
      preparedRef.current = null;
      return;
    }
    const localScope = runtimeRef.current;
    if (localScope.projectId == null) return;
    const queryUpdateCountAtReadStart =
      queryClient.getQueryState<ProjectsAllWithIndex>(PROJECTS_ALL_QUERY_KEY)
        ?.dataUpdateCount ?? 0;
    const proof: BoardAuthorizationProof = {
      accountId: localScope.accountId,
      projectId: localScope.projectId,
      authorizedProjectIds: [localScope.projectId],
      generation,
      requestId: `indexeddb:${activeKey}:${generation}`,
      queryUpdateCountAtAuthorization: queryUpdateCountAtReadStart,
      isCurrent: () =>
        localProofGenerationRef.current === generation &&
        runtimeRef.current.activeKey === activeKey,
    };
    void authorizeAndPublishLocalBoard(proof).then((published) => {
      if (!published || !proof.isCurrent()) return;
      runtimeRef.current.onLocalBoardPublished?.(
        proof.accountId,
        proof.projectId,
      );
    });
  }, [activeKey, authorizeAndPublishLocalBoard, queryClient]);

  const cancelPreparedLocalPublication = useCallback(() => {
    localProofGenerationRef.current += 1;
    // Cancelling means the published payload is being purged. Release the
    // claim or a later re-authorization of this same route would report
    // success without writing anything back.
    publishedLocalKeyRef.current = null;
  }, []);

  return {
    authorizeAndPublishLocalBoard,
    cancelPreparedLocalPublication,
  };
};

export const useSyncedBoardReadModel = ({
  enabled,
  accountId,
  projectId,
  accessStatus,
  queryClient,
  networkData,
  networkReady,
}: {
  enabled: boolean;
  accountId: number;
  projectId: number | null;
  accessStatus: "pending" | "local" | "authorized" | "denied";
  queryClient: QueryClient;
  networkData?: ProjectsAllWithIndex;
  networkReady: boolean;
}): void => {
  useEffect(() => {
    if (
      !enabled ||
      accessStatus !== "authorized" ||
      !networkReady ||
      !networkData ||
      networkData.accountId !== accountId ||
      networkData.dataOrigin !== "network" ||
      !accountId ||
      !projectId
    ) {
      return;
    }
    const project = networkData.updatedProjects?.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project || !isBoardPayloadHydrated(project) || !project.tasks) return;

    let cancelled = false;
    void import("@/lib/boardSync/indexedDbReadModel").then(
      ({ writeBoardReadModel }) => {
        if (cancelled) return false;
        return writeBoardReadModel({
          accountId,
          projectId,
          payload: {
            project,
            tasks: project.tasks!,
            allViews: project.project_view?.allViews ?? [],
          },
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [
    accessStatus,
    accountId,
    enabled,
    networkData,
    networkReady,
    projectId,
  ]);
};
