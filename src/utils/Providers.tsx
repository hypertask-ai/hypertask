"use client";
import { ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { FirstScreenSurfaceProvider } from "@/lib/firstScreen/SurfaceContext";
import { getBoardDocument, type BoardDocument } from "@/lib/firstScreen/boardDocument";
import { adoptBoardDocument, excludeBoardDocumentRestore } from "@/lib/firstScreen/boardAdoption";
import { getInboxDocument, type InboxDocument } from "@/lib/firstScreen/inboxDocument";
import { adoptInboxDocument, excludeInboxDocumentRestore } from "@/lib/firstScreen/inboxAdoption";
import { getTicketShellSeed, type TicketShellSeed } from "@/lib/firstScreen/ticketShell";
import type { FirstScreenFlags } from "@/lib/firstScreen/contract";
import type { BoardDisplay } from "@/lib/firstScreen/boardDisplay";
import BoardDisplayMirror from "@/lib/firstScreen/BoardDisplayMirror";
import MobileViewFlagBridge from "@/lib/contexts/MobileViewFlagBridge";
import { globalNotificationFocusAtom, currentUserAtom, currentProjectAtom, boardLayoutAtom, boardLayoutPreferenceAtom, appShellRailAtom,
  appShellRailExpandedAtom, showQuickTipsAtom, showEmptyViewTabsAtom, hiddenViewTabIdsAtom, viewTabsOrderAtom,
  tableVisibleColumnsAtom, tableColumnWidthsAtom, tableTitleWrapAtom, openAiChatByDefaultAtom, keepAiChatClosedAtom,
  aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, aiChatSidebarWidthPxAtom, isAiChatSidebarModeAtom } from "@/store";
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
import { FeatureFlagProvider, featureFlagsQueryKey } from "@/hooks/useFlag";
import { HTPR_7555_PERSIST_SIZE_ONCE_FLAG } from "@/lib/flags/definitions/htpr-7555-persist-size-once";
import {
  createQueryPersister,
  type DisposableQueryPersister,
} from "@/utils/queryIndexedDbPersister";
import {
  CHUNK_RELOAD_STORAGE_KEY,
  stripChunkRecoveryParam,
} from "@/utils/helperFunctions/chunkLoadRecovery";

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
  const values: StateInitialValues[number][] = [[currentUserAtom, snapshot.data.user], [currentProjectAtom, snapshot.data.projects.updatedProjects[0]],
    [boardLayoutAtom, snapshot.selection.surface], [boardLayoutPreferenceAtom, display.boardLayout],
    [appShellRailAtom, display.board.railOn], [appShellRailExpandedAtom, !display.railCollapsed], [showQuickTipsAtom, display.quickTips],
    [showEmptyViewTabsAtom, display.board.showEmptyViewTabs], [hiddenViewTabIdsAtom, display.board.hiddenViewTabIds],
    [viewTabsOrderAtom, display.board.viewTabsOrder], [tableVisibleColumnsAtom, display.board.tableColumns],
    [tableColumnWidthsAtom, display.board.tableWidths], [tableTitleWrapAtom, display.board.tableTitleWrap],
    [keepAiChatClosedAtom, display.board.keepChatClosed ?? false], [openAiChatByDefaultAtom, display.board.openChat], [aiChatAutoOpenSuppressedAtom, display.board.chatSuppressed], [aiChatPinnedAtom, display.board.chatPinned]];
  if (display.board.chatWidth !== undefined && display.board.chatSidebarMode !== undefined) {
    values.push([aiChatSidebarWidthPxAtom, display.board.chatWidth], [isAiChatSidebarModeAtom, display.board.chatSidebarMode]);
  }
  return values;
};

const inboxInitialValues = (snapshot: InboxDocument): StateInitialValues => {
  const display = snapshot.display as BoardDisplay;
  return [[currentUserAtom, snapshot.data.user], [globalNotificationFocusAtom, { currIdx: 0, currSplit: snapshot.selection.split ?? 0 }],
    [appShellRailAtom, display.board.railOn], [appShellRailExpandedAtom, !display.railCollapsed],
    [showQuickTipsAtom, snapshot.data.isInboxZero ? false : display.quickTips],
    [keepAiChatClosedAtom, display.board.keepChatClosed ?? false], [openAiChatByDefaultAtom, display.board.openChat], [aiChatAutoOpenSuppressedAtom, display.board.chatSuppressed], [aiChatPinnedAtom, display.board.chatPinned]];
};

const shellInitialValues = (display: BoardDisplay): StateInitialValues => {
  const values: StateInitialValues[number][] = [[boardLayoutPreferenceAtom, display.boardLayout],
    [appShellRailAtom, display.board.railOn], [appShellRailExpandedAtom, !display.railCollapsed], [showQuickTipsAtom, display.quickTips],
    [showEmptyViewTabsAtom, display.board.showEmptyViewTabs], [hiddenViewTabIdsAtom, display.board.hiddenViewTabIds],
    [viewTabsOrderAtom, display.board.viewTabsOrder], [tableVisibleColumnsAtom, display.board.tableColumns],
    [tableColumnWidthsAtom, display.board.tableWidths], [tableTitleWrapAtom, display.board.tableTitleWrap],
    [keepAiChatClosedAtom, display.board.keepChatClosed ?? false], [openAiChatByDefaultAtom, display.board.openChat],
    [aiChatAutoOpenSuppressedAtom, display.board.chatSuppressed], [aiChatPinnedAtom, display.board.chatPinned]];
  if (display.board.chatWidth !== undefined && display.board.chatSidebarMode !== undefined) {
    values.push([aiChatSidebarWidthPxAtom, display.board.chatWidth], [isAiChatSidebarModeAtom, display.board.chatSidebarMode]);
  }
  return values;
};

function isPublicSharePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/share" || pathname.startsWith("/share/");
}

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
  shellSeed,
  flagSeed,
  flagProvider: FlagProvider = FeatureFlagProvider,
}: {
  children: ReactNode;
  initialIsMobile: boolean;
  initialIsApple: boolean;
  authenticatedUserId: number | null;
  firstScreen?: BoardDocument | InboxDocument | null;
  shellSeed?: TicketShellSeed | null;
  flagSeed?: FirstScreenFlags | null;
  flagProvider?: typeof FeatureFlagProvider;
}) {
  const pathname = usePathname();
  const publicShare = isPublicSharePath(pathname);
  const [initialDocument] = useState(() => getBoardDocument(firstScreen ?? null, authenticatedUserId ?? 0) ?? getInboxDocument(firstScreen ?? null, authenticatedUserId ?? 0));
  const snapshot = initialDocument?.scope.accountId === authenticatedUserId ? initialDocument : null;
  const [initialShell] = useState(() => getTicketShellSeed(shellSeed ?? null, authenticatedUserId ?? 0));
  const shell = getTicketShellSeed(initialShell, authenticatedUserId ?? 0);
  const initialValues = useMemo(() => {
    if (!snapshot && shell) return shellInitialValues(shell.display);
    const inbox = getInboxDocument(snapshot, authenticatedUserId ?? 0);
    return inbox ? inboxInitialValues(inbox) : boardInitialValues(getBoardDocument(snapshot, authenticatedUserId ?? 0));
  }, [snapshot, shell, authenticatedUserId]);
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

  useEffect(() => {
    window.sessionStorage.removeItem("ht-root-reload");

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
      <PersistQueryClientProvider
        key={`query-account-${authenticatedUserId ?? "guest"}`}
        client={queryBoundary.client}
        persistOptions={{
          persister: queryBoundary.persister,
          buster: REACT_QUERY_PERSIST_BUSTER,
          maxAge: 1000 * 60 * 30,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) => shouldDehydratePersistedQuery(
              query,
              queryBoundary.client.getQueryData<Record<string, boolean>>(
                featureFlagsQueryKey(authenticatedUserId ?? 0),
              )?.[HTPR_7555_PERSIST_SIZE_ONCE_FLAG] === true,
            ),
          },
        }}
      >
        <DeviceProvider initialIsApple={initialIsApple}>
          <MobileViewProvider initialIsMobile={initialIsMobile}>
            <StateRoot key={`state-account-${authenticatedUserId ?? "guest"}`} initialValues={initialValues}>
              <UndoProvider>
                <MobileBlockingProvider>
                  <AuthProvider authenticatedUserId={authenticatedUserId}>
                    <TourProvider>
                      {publicShare ? (
                        <PublicShell><ThemeListener />{children}</PublicShell>
                      ) : (
                        <FlagProvider userId={authenticatedUserId} initialFlags={snapshot?.flags ?? shell?.flags ?? flagSeed ?? undefined}>
                          <ThemeListener />
                          <BoardDisplayMirror accountId={authenticatedUserId} />
                          <MobileViewFlagBridge />
                          <GlobalProvider authenticatedUserId={authenticatedUserId}>
                            {children}
                          </GlobalProvider>
                        </FlagProvider>
                      )}
                    </TourProvider>
                  </AuthProvider>
                </MobileBlockingProvider>
              </UndoProvider>
            </StateRoot>
          </MobileViewProvider>
        </DeviceProvider>
      </PersistQueryClientProvider>
    </FirstScreenSurfaceProvider>
  );
}
