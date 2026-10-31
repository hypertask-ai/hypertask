"use client";

import { useEffect, useRef } from "react";
import { HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG } from "@/lib/flags/definitions/htpr-8052-fullscreen-chat-return";
import { HTPR_8038_CHAT_OPENER_READY_FLAG } from "@/lib/flags/definitions/htpr-8038-chat-opener-ready";
import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import { usePathname, useSearchParams } from "next/navigation";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatAutoOpenPageAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, aiChatExplicitOpenAtAtom, aiChatEmbeddedTicketPathAtom, aiChatNewTicketPathAtom, currentUserAtom, currentProjectAtom, showAIChatInterfaceAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7783_REMEMBER_CHAT_FLAG } from "@/lib/flags/keys";
import { chatNavigationKey, readChatNavigationState, writeChatNavigationState } from "@/lib/aiChat/chatNavigationState";
import { aiChatAutoOpenPage } from "@/lib/aiChat/autoOpenPreferences";
import { useAiChatOpenPreferences, useSyncAiChatOpenPreferences } from "./useAiChatOpenPreferences";

function pageChangedSinceLastVisit(previous: string | null, lastSaved: string | null, pageKey: string, stableDefaultView: boolean) {
  const neverRecorded = previous === null && lastSaved === null;
  if (stableDefaultView && /^\d+:\/(project|demo):/.test(pageKey)) {
    return !neverRecorded && (previous ?? lastSaved)?.replace(/:default$/, ":") !== pageKey.replace(/:default$/, ":");
  }
  return !neverRecorded && (previous ?? lastSaved) !== pageKey;
}

export function useAiChatAutoOpen(mobile: boolean) {
  const manualChat = useFlag(HTPR_8088_MANUAL_CHAT_FLAG);
  const preserveFullScreenReturn = useFlag(HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG);
  const stableDefaultView = useFlag(HTPR_8038_CHAT_OPENER_READY_FLAG);
  useSyncAiChatOpenPreferences();
  const { enabled, ready, flagReady, values } = useAiChatOpenPreferences();
  const user = useRecoilValue(currentUserAtom);
  const board = useRecoilValue(currentProjectAtom);
  const rememberChat = useFlag(HTPR_7783_REMEMBER_CHAT_FLAG);
  const navigationKey = rememberChat ? chatNavigationKey(user?.id, board?.id) : null;
  const route = usePathname();
  const embeddedTicketPath = useRecoilValue(aiChatEmbeddedTicketPathAtom);
  const pathname = embeddedTicketPath ?? route;
  const search = useSearchParams();
  const [newTicketPath, setNewTicketPath] = useRecoilState(aiChatNewTicketPathAtom);
  const [suppressed, setSuppressed] = useRecoilState(aiChatAutoOpenSuppressedAtom);
  const pinned = useRecoilValue(aiChatPinnedAtom) === true;
  const [open, setOpen] = useRecoilState(showAIChatInterfaceAtom);
  const setExplicitOpenAt = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const page = pathname ? aiChatAutoOpenPage(pathname, newTicketPath) : null;
  const pageKey = `${user?.id}:${pathname}:${search?.get("id") ?? ""}:${search?.get("view") ?? ""}`;
  const [lastPage, setLastPage] = useRecoilState(aiChatAutoOpenPageAtom);
  const previousPage = useRef<string | null>(null);
  const previousRoute = useRef<string | null>(null);
  const restoredPage = useRef<string | null>(null);
  const restoreVisit = useRef<string | null>(null);
  const attemptedRestore = useRef<string | null>(null);
  const pendingOpenRestore = useRef<boolean | null>(null);
  const visitedNewTicket = useRef(false);
  const autoOpenedPage = useRef<string | null>(null);
  const navigationPageKey = `${navigationKey}:${pageKey}`;
  const fullScreenReturnPage = useRef<string | null>(null);
  const manualOpen = !embeddedTicketPath && (search?.get("newTaskAi") === "1" || search?.get("welcome_ai") === "1" || search?.has("agentSidebar") === true);
  const allowed = page !== null && (manualChat
    ? page === "aiChatOpenNewTickets" && values[page]
    : values[page] || (pinned && !mobile));

  useEffect(() => {
    if (!enabled || !ready || !pathname || !user?.id) {
      previousPage.current = null;
      return;
    }
    if (previousPage.current !== pageKey) restoredPage.current = null;
    if (previousRoute.current === null || previousRoute.current.startsWith("/settings")) {
      restoreVisit.current = pageKey;
      attemptedRestore.current = null;
    } else if (previousPage.current !== pageKey) restoreVisit.current = null;
    const savedOpen = readChatNavigationState(navigationKey).open;
    const restorePanel = navigationKey && page && page !== "aiChatOpenNewTickets" && !manualOpen && typeof savedOpen === "boolean" &&
      restoreVisit.current === pageKey && attemptedRestore.current !== navigationPageKey;
    if (navigationKey && page && restoreVisit.current === pageKey) attemptedRestore.current = navigationPageKey;
    previousRoute.current = route;
    const returningFromFullScreen = preserveFullScreenReturn && (previousPage.current ?? lastPage)?.startsWith(`${user.id}:/chat`);
    const changed = pageChangedSinceLastVisit(previousPage.current, lastPage, pageKey, stableDefaultView);
    if (lastPage !== pageKey) setLastPage(pageKey);
    previousPage.current = pageKey;
    if (pathname === newTicketPath) visitedNewTicket.current = true;
    else if (visitedNewTicket.current) {
      visitedNewTicket.current = false;
      setNewTicketPath(null);
    }
    if (!preserveFullScreenReturn || fullScreenReturnPage.current !== pageKey) fullScreenReturnPage.current = null;
    if (returningFromFullScreen) {
      autoOpenedPage.current = null;
      fullScreenReturnPage.current = pageKey;
    }

    if (!page || manualOpen || fullScreenReturnPage.current === pageKey) return;
    if (restorePanel && typeof savedOpen === "boolean") {
      restoredPage.current = navigationPageKey;
      pendingOpenRestore.current = savedOpen;
      setOpen(savedOpen);
      return;
    }
    if (navigationKey && restoredPage.current === navigationPageKey) return;
    if (changed) setSuppressed(false);
    if ((suppressed && !changed) || !allowed) {
      const savedOffAfterAutoOpen = !allowed && autoOpenedPage.current !== null && !pageChangedSinceLastVisit(autoOpenedPage.current, null, pageKey, stableDefaultView);
      if (!manualChat && (changed || savedOffAfterAutoOpen)) setOpen(false);
      autoOpenedPage.current = null;
      return;
    }
    autoOpenedPage.current = pageKey;
    setExplicitOpenAt(null);
    setOpen(true);
  }, [navigationKey, navigationPageKey, route, enabled, ready, pathname, pageKey, page, newTicketPath, manualOpen, allowed, mobile, user?.id, manualChat, stableDefaultView, preserveFullScreenReturn, suppressed, setSuppressed, setOpen, setExplicitOpenAt, setNewTicketPath, lastPage, setLastPage]);

  useEffect(() => {
    if (!enabled || !ready || !navigationKey || !page || manualOpen) return;
    if (pendingOpenRestore.current !== null) {
      if (open !== pendingOpenRestore.current) return;
      pendingOpenRestore.current = null;
    }
    writeChatNavigationState(navigationKey, { open });
  }, [enabled, ready, navigationKey, page, pageKey, manualOpen, open]);

  if (manualChat) return { reserve: false };
  const active = enabled || !flagReady;
  const pageChanged = pageChangedSinceLastVisit(previousPage.current, lastPage, pageKey, stableDefaultView);
  const savedOpen = readChatNavigationState(navigationKey).open;
  const restorationPending = previousRoute.current === null || previousRoute.current.startsWith("/settings") ||
    (restoreVisit.current === pageKey && attemptedRestore.current !== navigationPageKey);
  const restoringPanel = navigationKey && page && page !== "aiChatOpenNewTickets" && typeof savedOpen === "boolean" &&
    (restoredPage.current === navigationPageKey || restorationPending);
  const rememberedOpen = restorationPending ? savedOpen === true : open;
  const reserve = active && !mobile && (restoringPanel ? rememberedOpen : allowed && !(suppressed && !pageChanged));
  return { reserve };
}
