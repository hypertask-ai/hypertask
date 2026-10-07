"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ITask } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG, HTPR_6991_BACK_FIRST_OPEN_FLAG, HTPR_7000_INBOX_NEXT_OPEN_FLAG, HTPR_7002_INBOX_E_FIRST_PRESS_FLAG } from "@/lib/flags/keys";
import { cachedTaskDetailKey, cachedTaskDetailLocation, findCachedTaskDetail, openCachedTaskDetail, type CachedTaskDetailLocation } from "@/lib/navigation/cachedTaskDetail";

import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";

let loadedTaskDetail: typeof import("@/components/Modals/SwipeUnread/EmbeddedTaskDetail").default | undefined;
const loadTaskDetail = () => import("@/components/Modals/SwipeUnread/EmbeddedTaskDetail").then((module) => {
  loadedTaskDetail = module.default;
  return module;
});

const subscribeToLocation = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener("cached-task-detail-navigation", notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("cached-task-detail-navigation", notify);
  };
};
const browserPathname = () => window.location.pathname;
const serverPathname = () => null;

const warmTaskDetail = () => Promise.all([
  loadTaskDetail(),
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton"),
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions"),
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions"),
  import("@/components/PageComponents/TaskDetail/TaskMovement"),
  // These nested imports otherwise start when the first comments/provider mount.
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/EmojiOptionsComp"),
  import("@/lib/constants/emojiData"),
  import("@/firebase"),
  import("firebase/messaging"),
  import("@/components/RTE/Extensions/lazyEmojiData").then(({ ensureEmojiData }) => ensureEmojiData()),
]);

export default function CachedTaskDetailNavigation({ children, accountId }: {
  children: ReactNode;
  accountId: number | null;
}) {
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const subtaskLink = useFlag(HTPR_6972_SUBTASK_LINK_FLAG);
  const inboxNextOpen = useFlag(HTPR_7000_INBOX_NEXT_OPEN_FLAG);
  const backFirstOpen = useFlag(HTPR_6991_BACK_FIRST_OPEN_FLAG);
  const inboxEFirstPress = useFlag(HTPR_7002_INBOX_E_FIRST_PRESS_FLAG);
  const queryClient = useQueryClient();
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
  const [historyDestination, setHistoryDestination] = useState<{ pathname: string } | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const currentUser = useRecoilValue(currentUserAtom);
  const previousLocation = useRef<CachedTaskDetailLocation | undefined>(undefined);
  const [taskDetail, setTaskDetail] = useState(() => loadedTaskDetail);
  const EmbeddedTaskDetail = taskDetail ?? loadedTaskDetail;
  // Cached opens retain Next's source tree, so popstate must update the view independently.
  const nativePathname = useSyncExternalStore(subscribeToLocation, browserPathname, serverPathname);
  useEffect(() => {
    // Next commits router push/replace in an insertion effect without a native location event.
    if (inboxNextOpen) window.dispatchEvent(new window.Event("cached-task-detail-navigation"));
  }, [inboxNextOpen, pathname]);
  // Next can replace custom history state while refreshing the same route.
  const location = cachedTaskDetailLocation(
    nativePathname ?? pathname,
    instantTicketOpen && currentUser?.id === accountId ? accountId : null,
    typeof window === "undefined" ? null : {
      cachedTaskDetail: window.history.state?.cachedTaskDetail ?? previousLocation.current,
    },
  );
  previousLocation.current = location;
  useEffect(() => {
    if ((!subtaskLink && !backFirstOpen) || !instantTicketOpen || accountId === null || currentUser?.id !== accountId) return;
    const restoreCachedTask = (event: Event) => {
      // Next can update a nested native detail while this layout still holds the source pathname.
      const sourcePath = backFirstOpen
        ? [...document.querySelectorAll<HTMLElement>("#title-input")]
          .find((title) => title.getClientRects().length > 0)
          ?.closest("[data-task-detail-path]")?.getAttribute("data-task-detail-path")
        : location ? `/detail/project-${location.projectId}/${location.uniqueIndex}` : pathname;
      if (window.location.pathname === sourcePath) return;
      const route = window.location.pathname.match(/^\/detail\/project-(\d+)\/(\d+)$/);
      const task = route ? findCachedTaskDetail(queryClient, accountId, Number(route[1]), Number(route[2])) : undefined;
      if (!task) {
        if (backFirstOpen && route) flushSync(() => setHistoryDestination({ pathname: window.location.pathname }));
        return;
      }
      // The root relay runs before Next's native listener, which otherwise replays a stale route tree.
      (event as CustomEvent<PopStateEvent>).detail.stopImmediatePropagation();
      flushSync(() => {
        if (backFirstOpen) setHistoryDestination({ pathname: window.location.pathname });
        openCachedTaskDetail({
          queryClient, accountId, projectId: task.projectId, uniqueIndex: task.uniqueIndex,
          task, href: window.location.pathname + window.location.search + window.location.hash, replace: true,
        });
      });
    };
    window.addEventListener("cached-task-detail-popstate", restoreCachedTask);
    return () => window.removeEventListener("cached-task-detail-popstate", restoreCachedTask);
  }, [subtaskLink, backFirstOpen, instantTicketOpen, accountId, currentUser?.id, queryClient, location, pathname]);
  useEffect(() => {
    if (!location) return;
    const restoreSourceRoute = (event: PopStateEvent) => {
      // Native detail traversal publishes the destination URL while its RSC is pending.
      if (backFirstOpen && /^\/detail\/project-\d+\/\d+$/.test(window.location.pathname)) return;
      if (!event.state?.__NA || !event.state?.__PRIVATE_NEXTJS_INTERNALS_TREE ||
          // Same-task modal Back must reach its dismiss listener even if Next
          // stripped the cached marker, just as rendering retains that location.
          cachedTaskDetailLocation(window.location.pathname, accountId, {
            cachedTaskDetail: event.state?.cachedTaskDetail ?? previousLocation.current,
          })) return;
      // Next's native-history restore can cache detail RSC in the source route's slot.
      // Revalidate the source URL instead of traversing that stale route payload.
      event.stopImmediatePropagation();
      router.replace(window.location.pathname + window.location.search + window.location.hash);
      router.refresh();
      window.dispatchEvent(new Event("cached-task-detail-navigation"));
    };
    window.addEventListener("popstate", restoreSourceRoute, true);
    return () => window.removeEventListener("popstate", restoreSourceRoute, true);
  }, [location, accountId, router, backFirstOpen]);
  useEffect(() => {
    if (!instantTicketOpen || accountId === null || currentUser?.id !== accountId ||
        !pathname || !["/project", "/my-tasks", "/inbox"].includes(pathname)) return;
    const connection = (window.navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    let frame: number | undefined;
    let idle: number | undefined;
    let timer: number | undefined;
    let warming = false;
    const warm = () => {
      if (warming) return;
      warming = true;
      // Import only: no ticket requests, editor mounts or permission prompts.
      void warmTaskDetail().catch(() => { warming = false; });
    };
    document.addEventListener("pointerdown", warm, { capture: true, passive: true });
    // Leave a paint opportunity before warming code that the page does not need.
    if (!connection?.saveData && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) {
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (window.requestIdleCallback) idle = window.requestIdleCallback(warm, { timeout: 5000 });
          else timer = window.setTimeout(warm, 2000);
        });
      });
    }
    return () => {
      document.removeEventListener("pointerdown", warm, true);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [instantTicketOpen, accountId, currentUser?.id, pathname]);
  const task = location && queryClient.getQueryData<ITask>(
    cachedTaskDetailKey(location.accountId, location.taskId),
  );
  useEffect(() => {
    if (location && !task) router.replace(window.location.pathname + window.location.search + window.location.hash);
  }, [location, task, router]);
  const showDetail = instantTicketOpen && !!location && !!task && task.projectId === location.projectId && task.uniqueIndex === location.uniqueIndex;
  useEffect(() => {
    const nativeDetail = backFirstOpen && instantTicketOpen && accountId !== null && currentUser?.id === accountId && pathname?.startsWith("/detail/project-");
    if ((!showDetail && !nativeDetail) || EmbeddedTaskDetail) return;
    let cancelled = false;
    void loadTaskDetail().then(({ default: Detail }) => {
      if (!cancelled) {
        setTaskDetail(() => Detail);
      }
    }).catch(() => {
      if (!cancelled) router.replace(window.location.pathname + window.location.search + window.location.hash);
    });
    return () => { cancelled = true; };
  }, [showDetail, EmbeddedTaskDetail, router, backFirstOpen, instantTicketOpen, accountId, currentUser?.id, pathname]);
  useEffect(() => {
    if (!historyDestination || showDetail || accountId === null || currentUser?.id !== accountId) return;
    let restored = false;
    const restoreDestination = () => {
      if (restored || window.location.pathname !== historyDestination.pathname) return;
      const route = historyDestination.pathname.match(/^\/detail\/project-(\d+)\/(\d+)$/);
      const destination = route && findCachedTaskDetail(queryClient, accountId, Number(route[1]), Number(route[2]));
      if (!destination) return;
      // Native detail seeds its authorized task after RSC renders, even when Next retains the children element.
      restored = true;
      openCachedTaskDetail({
        queryClient, accountId, projectId: destination.projectId, uniqueIndex: destination.uniqueIndex,
        task: destination, href: window.location.pathname + window.location.search + window.location.hash, replace: true,
      });
      // Seeding the same URL does not change the external location snapshot.
      setHistoryDestination({ pathname: historyDestination.pathname });
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(restoreDestination);
    restoreDestination();
    return unsubscribe;
  }, [historyDestination, accountId, currentUser?.id, queryClient, showDetail]);
  useEffect(() => {
    if (!historyDestination) return;
    // Error/unavailable routes may never seed the task cache. Let their children surface.
    const timer = window.setTimeout(() => setHistoryDestination(null), 4000);
    return () => window.clearTimeout(timer);
  }, [historyDestination]);
  const suppressPreviousTask = backFirstOpen && instantTicketOpen && currentUser?.id === accountId &&
    historyDestination?.pathname === nativePathname;
  if (!showDetail && suppressPreviousTask) {
    return (
      <>
        {/* Pending native RSC must not suspend the visible protection. */}
        <div hidden><Suspense fallback={null}>{children}</Suspense></div>
        <div role="status" data-task-path={historyDestination.pathname} className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
          Loading task…
        </div>
      </>
    );
  }
  if (suppressPreviousTask && showDetail && !EmbeddedTaskDetail) return null;
  if (!showDetail || !EmbeddedTaskDetail) return children;
  const detail = (
    <EmbeddedTaskDetail
      key={`${location.accountId}:${location.taskId}`}
      taskId={location.taskId}
      projectId={location.projectId}
      uniqueIndex={location.uniqueIndex}
      initialTask={task}
      embedded={false}
    />
  );
  // Only cross-task history traversal must hide the previous route during suspension.
  return backFirstOpen ? <Suspense key={`${location.accountId}:${location.taskId}`} fallback={suppressPreviousTask ? null : children}>{detail}</Suspense> : detail;
}
