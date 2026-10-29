"use client";

import { useEffect, useRef } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8052_FULLSCREEN_CHAT_RETURN_FLAG } from "@/lib/flags/definitions/htpr-8052-fullscreen-chat-return";
import { HTPR_8038_CHAT_OPENER_READY_FLAG } from "@/lib/flags/definitions/htpr-8038-chat-opener-ready";
import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import { usePathname, useSearchParams } from "next/navigation";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatAutoOpenPageAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, aiChatExplicitOpenAtAtom, aiChatEmbeddedTicketPathAtom, aiChatNewTicketPathAtom, currentUserAtom, showAIChatInterfaceAtom } from "@/store";
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
  const route = usePathname();
  const embeddedTicketPath = useRecoilValue(aiChatEmbeddedTicketPathAtom);
  const pathname = embeddedTicketPath ?? route;
  const search = useSearchParams();
  const [newTicketPath, setNewTicketPath] = useRecoilState(aiChatNewTicketPathAtom);
  const [suppressed, setSuppressed] = useRecoilState(aiChatAutoOpenSuppressedAtom);
  const pinned = useRecoilValue(aiChatPinnedAtom) === true;
  const setOpen = useSetRecoilState(showAIChatInterfaceAtom);
  const setExplicitOpenAt = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const page = pathname ? aiChatAutoOpenPage(pathname, newTicketPath) : null;
  const pageKey = `${user?.id}:${pathname}:${search?.get("id") ?? ""}:${search?.get("view") ?? ""}`;
  const [lastPage, setLastPage] = useRecoilState(aiChatAutoOpenPageAtom);
  const previousPage = useRef<string | null>(null);
  const visitedNewTicket = useRef(false);
  const autoOpenedPage = useRef<string | null>(null);
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
  }, [enabled, ready, pathname, pageKey, page, manualChat, newTicketPath, manualOpen, allowed, mobile, user?.id, stableDefaultView, preserveFullScreenReturn, suppressed, setSuppressed, setOpen, setExplicitOpenAt, setNewTicketPath, lastPage, setLastPage]);

  const active = enabled || !flagReady;
  const pageChanged = pageChangedSinceLastVisit(previousPage.current, lastPage, pageKey, stableDefaultView);
  const reserve = !manualChat && active && !mobile && allowed && !(suppressed && !pageChanged);
  return { reserve };
}
