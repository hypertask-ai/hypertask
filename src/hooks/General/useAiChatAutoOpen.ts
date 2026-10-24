"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatAutoOpenPageAtom, aiChatAutoOpenSuppressedAtom, aiChatPinnedAtom, aiChatExplicitOpenAtAtom, aiChatEmbeddedTicketPathAtom, aiChatNewTicketPathAtom, currentUserAtom, showAIChatInterfaceAtom } from "@/store";
import { aiChatAutoOpenPage } from "@/lib/aiChat/autoOpenPreferences";
import { useAiChatOpenPreferences, useSyncAiChatOpenPreferences } from "./useAiChatOpenPreferences";

function pageChangedSinceLastVisit(previous: string | null, lastSaved: string | null, pageKey: string) {
  const neverRecorded = previous === null && lastSaved === null;
  return !neverRecorded && (previous ?? lastSaved) !== pageKey;
}

export function useAiChatAutoOpen(mobile: boolean) {
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
  const manualOpen = !embeddedTicketPath && (search?.get("newTaskAi") === "1" || search?.get("welcome_ai") === "1" || search?.has("agentSidebar") === true);
  const allowed = page !== null && (values[page] || (pinned && !mobile));

  useEffect(() => {
    if (!enabled || !ready || !pathname || !user?.id) {
      previousPage.current = null;
      return;
    }
    const changed = pageChangedSinceLastVisit(previousPage.current, lastPage, pageKey);
    if (lastPage !== pageKey) setLastPage(pageKey);
    previousPage.current = pageKey;
    if (pathname === newTicketPath) visitedNewTicket.current = true;
    else if (visitedNewTicket.current) {
      visitedNewTicket.current = false;
      setNewTicketPath(null);
    }
    if (!page || manualOpen) return;
    if (changed) setSuppressed(false);
    if ((suppressed && !changed) || !allowed) {
      const savedOffAfterAutoOpen = !allowed && autoOpenedPage.current === pageKey;
      if (changed || savedOffAfterAutoOpen) setOpen(false);
      autoOpenedPage.current = null;
      return;
    }
    autoOpenedPage.current = pageKey;
    setExplicitOpenAt(null);
    setOpen(true);
  }, [enabled, ready, pathname, pageKey, page, newTicketPath, manualOpen, allowed, mobile, user?.id, suppressed, setSuppressed, setOpen, setExplicitOpenAt, setNewTicketPath, lastPage, setLastPage]);

  const active = enabled || !flagReady;
  const pageChanged = pageChangedSinceLastVisit(previousPage.current, lastPage, pageKey);
  const reserve = active && !mobile && allowed && !(suppressed && !pageChanged);
  return { reserve };
}
