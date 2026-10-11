import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7002_INBOX_E_FIRST_PRESS_FLAG } from "@/lib/flags/keys";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";

export function useInboxEFirstPressQueue(queryClient: QueryClient) {
  const inboxEFirstPress = useFlag(HTPR_7002_INBOX_E_FIRST_PRESS_FLAG);
  // The phone workspace remounts its children when the detail route commits; keep queued E above it.
  useEffect(() => {
    if (!inboxEFirstPress) return;
    let keyboard: { path: string; ready: boolean; handleKeyDown?: (event: KeyboardEvent) => void } | undefined;
    let pending: { path: string; event: KeyboardEvent } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let slow = false;
    const clearPending = () => {
      pending = undefined;
      slow = false;
      if (timer !== undefined) clearTimeout(timer);
      if (poll !== undefined) clearTimeout(poll);
      timer = poll = undefined;
    };
    const onNavigation = () => {
      if (pending && (window.location.pathname !== pending.path ||
          new URLSearchParams(window.location.search).get("inboxFlow") !== "true")) clearPending();
    };
    const release = () => {
      if (poll !== undefined) clearTimeout(poll);
      poll = undefined;
      onNavigation();
      if (!pending) return;
      // The detail navigator blocks uploads; do not archive until it can also advance.
      if (keyboard?.path === pending.path && keyboard.handleKeyDown && (keyboard.ready || slow) &&
          !queryClient.getQueryData(REACT_QUERY_KEYS.uploadStates)) {
        const event = pending.event;
        const handleKeyDown = keyboard.handleKeyDown;
        clearPending();
        handleKeyDown(event);
      } else {
        poll = setTimeout(() => { poll = undefined; release(); }, 16);
      }
    };
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<typeof keyboard>).detail;
      if (detail?.handleKeyDown || detail?.path === keyboard?.path) keyboard = detail;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.keyCode !== 69 || event.ctrlKey || event.metaKey || returnIfModalOrInputActive(true)) return;
      const path = window.location.pathname;
      if (!path.startsWith("/detail/project-") || new URLSearchParams(window.location.search).get("inboxFlow") !== "true") return;
      if (keyboard?.path === path && keyboard.ready && !queryClient.getQueryData(REACT_QUERY_KEYS.uploadStates)) return;
      // The Inbox listener can outlive its URL, or disappear before the detail listener mounts.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pending?.path === path) return;
      clearPending();
      pending = { path, event };
      timer = setTimeout(() => {
        timer = undefined;
        onNavigation();
        if (!pending || keyboard?.path !== pending.path || !keyboard.handleKeyDown) return clearPending();
        // A mounted slow detail can use its Inbox-cache membership before the fetch resolves.
        slow = true;
        timer = setTimeout(() => { timer = undefined; clearPending(); }, 4000);
        release();
      }, 2000);
      poll = setTimeout(() => { poll = undefined; release(); }, 16);
    };
    window.addEventListener("htpr-7002-detail-keyboard", onReady);
    window.addEventListener("popstate", onNavigation);
    window.addEventListener("cached-task-detail-navigation", onNavigation);
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearPending();
      window.removeEventListener("htpr-7002-detail-keyboard", onReady);
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener("cached-task-detail-navigation", onNavigation);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [inboxEFirstPress, queryClient]);
}
