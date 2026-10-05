"use client";
import { ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FirstScreenSurfaceProvider } from "@/lib/firstScreen/SurfaceContext";
import { getBoardDocument, type BoardDocument } from "@/lib/firstScreen/boardDocument";
import { adoptBoardDocument, excludeBoardDocumentRestore } from "@/lib/firstScreen/boardAdoption";
import { getInboxDocument, type InboxDocument } from "@/lib/firstScreen/inboxDocument";
import { adoptInboxDocument, excludeInboxDocumentRestore } from "@/lib/firstScreen/inboxAdoption";
import type { BoardDisplay } from "@/lib/firstScreen/boardDisplay";
import BoardDisplayMirror from "@/lib/firstScreen/BoardDisplayMirror";
import { globalNotificationFocusAtom, currentUserAtom, currentProjectAtom, boardLayoutAtom, boardLayoutPreferenceAtom, appShellRailAtom,
  appShellRailExpandedAtom, showQuickTipsAtom, showEmptyViewTabsAtom, hiddenViewTabIdsAtom, viewTabsOrderAtom,
  tableVisibleColumnsAtom, tableColumnWidthsAtom, tableTitleWrapAtom, openAiChatByDefaultAtom,
  aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom } from "@/store";
import type { StateInitialValues } from "@/lib/state";
import { usePathname } from "next/navigation";
import { Toaster } from "react-hot-toast";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StateRoot } from "@/lib/state";
import { AuthProvider } from "@/hooks/General/useAuth";
import GlobalProvider from "@/components/ProviderGlobal/GloablProviders";
import MobileViewProvider from "@/lib/contexts/mobileContext";
import { UndoProvider } from "@/hooks/General/useUndo";
import { DeviceProvider } from "@/lib/contexts/deviceContext";
import ThemeListener from "@/lib/contexts/ThemeListener";
import { MobileBlockingProvider } from "@/lib/contexts/mobileBlockingContext";
import { TourProvider } from "@/lib/contexts/TourContext";
import { shouldDehydratePersistedQuery } from "@/utils/queryPersistence";
import { FeatureFlagProvider } from "@/hooks/useFlag";
import {
  createQueryPersister,
  type DisposableQueryPersister,
} from "@/utils/queryIndexedDbPersister";
import {
  CHUNK_RELOAD_STORAGE_KEY,
  stripChunkRecoveryParam,
} from "@/utils/helperFunctions/chunkLoadRecovery";

// Never persist the inbox: a restored snapshot can predate an archive, and while it is
// still within staleTime react-query serves it without refetching, so an archived
// notification comes back on reload until the snapshot ages out (HTPR-4086).
// Preferences are not persisted either: the query key is global, not per user,
// so a persisted snapshot survived switchAccount's hard reload and showed the
// previous account its predecessor's snippets, AI models, notification matrix
// and saved calendar views for up to five minutes (HTPR-4693). They are one
// small request on load, so keeping them in memory only costs nothing.
const REACT_QUERY_PERSIST_BUSTER =
  "startup-budget-v3-view-show-archived";
const CHUNK_RECOVERY_STABLE_MS = 30 * 1000;

type QueryBoundary = {
  accountId: number | null;
  client: QueryClient;
  persister: DisposableQueryPersister;
};

const createQueryBoundary = (accountId: number | null, snapshot: BoardDocument | InboxDocument | null): QueryBoundary => {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 4 } },
  });
  const persister = createQueryPersister(accountId);
  if (!snapshot) return { accountId, client, persister };
  const inbox = getInboxDocument(snapshot, accountId ?? 0);
  const board = getBoardDocument(snapshot, accountId ?? 0);
  if (inbox) adoptInboxDocument(client, inbox);
  if (board) adoptBoardDocument(client, board);
  return { accountId, client, persister: { ...persister,
    restoreClient: async () => {
      const restored = await persister.restoreClient();
      return inbox ? excludeInboxDocumentRestore(restored, inbox) : board ? excludeBoardDocumentRestore(restored, board) : restored;
    },
  } };
};

const boardInitialValues = (snapshot: BoardDocument | null): StateInitialValues | undefined => {
  if (!snapshot) return undefined;
  const display = snapshot.display as BoardDisplay;
  return [[currentUserAtom, snapshot.data.user], [currentProjectAtom, snapshot.data.projects.updatedProjects[0]],
    [boardLayoutAtom, snapshot.selection.surface], [boardLayoutPreferenceAtom, display.boardLayout],
    [appShellRailAtom, display.board.railOn], [appShellRailExpandedAtom, !display.railCollapsed], [showQuickTipsAtom, display.quickTips],
    [showEmptyViewTabsAtom, display.board.showEmptyViewTabs], [hiddenViewTabIdsAtom, display.board.hiddenViewTabIds],
    [viewTabsOrderAtom, display.board.viewTabsOrder], [tableVisibleColumnsAtom, display.board.tableColumns],
    [tableColumnWidthsAtom, display.board.tableWidths], [tableTitleWrapAtom, display.board.tableTitleWrap],
    [openAiChatByDefaultAtom, display.board.openChat], [aiChatAutoOpenSuppressedAtom, display.board.chatSuppressed], [aiChatPinnedAtom, display.board.chatPinned]];
};

const inboxInitialValues = (snapshot: InboxDocument): StateInitialValues => {
  const display = snapshot.display as BoardDisplay;
  return [[currentUserAtom, snapshot.data.user], [globalNotificationFocusAtom, { currIdx: 0, currSplit: snapshot.selection.split ?? 0 }],
    [appShellRailAtom, display.board.railOn], [appShellRailExpandedAtom, !display.railCollapsed],
    [showQuickTipsAtom, snapshot.data.isInboxZero ? false : display.quickTips],
    [openAiChatByDefaultAtom, display.board.openChat], [aiChatAutoOpenSuppressedAtom, display.board.chatSuppressed], [aiChatPinnedAtom, display.board.chatPinned]];
};

/** Public share links: read-only, never the signed-in app shell. */
function isPublicSharePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/share" || pathname.startsWith("/share/");
}

/**
 * GlobalProvider mounts the whole signed-in shell (sidebars, modals, teams /
 * favorites / announcements / realtime queries). On a public /share link a
 * signed-in non-member gained nothing from it, but its queries fired mid-
 * hydration. With an RSC request in flight, Next 14's AppRouter hits its
 * conditional `use(state)` (useUnwrapState) and React throws #310, taking the
 * whole page down. Rendering a minimal shell here removes that. HTPR-4089.
 *
 * GlobalProvider exposes no context, so nothing under /share depends on it.
 */
function PublicShell({ children }: { children: ReactNode }) {
  const mbl = useContext(MobileViewContext);
  return (
    <div className="scrollbar-none text-white-black">
      <Toaster
        containerClassName={mbl ? "toastContainerMobile" : ""}
        toastOptions={{
          duration: 3000,
          style: { background: "#222222", color: "white" },
        }}
        position={mbl ? "top-right" : "bottom-left"}
      />
      {children}
    </div>
  );
}

export default function Provider({
  children,
  initialIsMobile,
  initialIsApple,
  authenticatedUserId,
  firstScreen,
}: {
  children: ReactNode;
  initialIsMobile: boolean;
  initialIsApple: boolean;
  authenticatedUserId: number | null;
  firstScreen?: BoardDocument | InboxDocument | null;
}) {
  const pathname = usePathname();
  const publicShare = isPublicSharePath(pathname);
  // A document seed is adopted only at the existing account boundary's mount,
  // never on a later RSC navigation over a live edit or cached ticket/back tree.
  const [initialDocument] = useState(() => getBoardDocument(firstScreen ?? null, authenticatedUserId ?? 0) ?? getInboxDocument(firstScreen ?? null, authenticatedUserId ?? 0));
  const snapshot = initialDocument?.scope.accountId === authenticatedUserId ? initialDocument : null;
  const initialValues = useMemo(() => {
    const inbox = getInboxDocument(snapshot, authenticatedUserId ?? 0);
    return inbox ? inboxInitialValues(inbox) : boardInitialValues(getBoardDocument(snapshot, authenticatedUserId ?? 0));
  }, [snapshot, authenticatedUserId]);
  const queryBoundary = useMemo(
    () => createQueryBoundary(authenticatedUserId, snapshot),
    [authenticatedUserId, snapshot],
  );
  const previousQueryBoundary = useRef(queryBoundary);

  useEffect(() => {
    const previous = previousQueryBoundary.current;
    if (previous.accountId === queryBoundary.accountId) return;
    previous.client.clear();
    previous.persister.dispose();
    previousQueryBoundary.current = queryBoundary;
  }, [queryBoundary]);

  // Reaching here means the root chain mounted, so clear global-error's
  // auto-reload budget. Without this a tab that recovered twice would show the
  // error page on the next unrelated root crash instead of re-hydrating.
  useEffect(() => {
    window.sessionStorage.removeItem("ht-root-reload");

    // Provider mount alone is not proof that every descendant/lazy chunk is
    // healthy. Preserve the capped attempt budget until the recovered tree has
    // stayed mounted; an error-boundary unmount cancels this reset and prevents
    // a persistent missing chunk from creating an infinite navigation loop.
    const stableTimer = window.setTimeout(() => {
      window.sessionStorage.removeItem(CHUNK_RELOAD_STORAGE_KEY);

      const cleanUrl = stripChunkRecoveryParam(window.location.href);
      if (cleanUrl) {
        window.history.replaceState(window.history.state, "", cleanUrl);
      }
    }, CHUNK_RECOVERY_STABLE_MS);

    return () => window.clearTimeout(stableTimer);
  }, []);

  return (
    <FirstScreenSurfaceProvider snapshot={snapshot}>
      <ThemeListener />
      {/* <RootErrorBoundary> */}
      <PersistQueryClientProvider
        key={`query-account-${authenticatedUserId ?? "guest"}`}
        client={queryBoundary.client}
        persistOptions={{
          persister: queryBoundary.persister,
          buster: REACT_QUERY_PERSIST_BUSTER,
          maxAge: 1000 * 60 * 30,
          dehydrateOptions: {
            shouldDehydrateQuery: shouldDehydratePersistedQuery,
          },
        }}
      >
        <DeviceProvider initialIsApple={initialIsApple}>
          {/* MobileViewProvider wraps UndoProvider: the undo pipeline reads
              the viewport to anchor the toast left on mobile (HTPR-5564). */}
          <MobileViewProvider initialIsMobile={initialIsMobile}>
            <StateRoot key={`state-account-${authenticatedUserId ?? "guest"}`} initialValues={initialValues}>
              <UndoProvider>
                <MobileBlockingProvider>
                  <AuthProvider authenticatedUserId={authenticatedUserId}>
                    <TourProvider>
                      {publicShare ? (
                        <PublicShell>{children}</PublicShell>
                      ) : (
                        <FeatureFlagProvider userId={authenticatedUserId} initialFlags={snapshot?.flags}>
                          <BoardDisplayMirror accountId={authenticatedUserId} />
                          <GlobalProvider authenticatedUserId={authenticatedUserId}>
                            {children}
                          </GlobalProvider>
                        </FeatureFlagProvider>
                      )}
                    </TourProvider>
                  </AuthProvider>
                </MobileBlockingProvider>
              </UndoProvider>
            </StateRoot>
          </MobileViewProvider>
        </DeviceProvider>
      </PersistQueryClientProvider>
      {/* </RootErrorBoundary> */}
      {/* <QueryClientProvider client={queryClient}> */}
      {/* </QueryClientProvider> */}
    </FirstScreenSurfaceProvider>
  );
}
