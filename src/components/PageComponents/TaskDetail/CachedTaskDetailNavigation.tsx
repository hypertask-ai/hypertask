"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ITask } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG, HTPR_6991_BACK_FIRST_OPEN_FLAG, HTPR_7000_INBOX_NEXT_OPEN_FLAG } from "@/lib/flags/keys";
import { cachedTaskDetailKey, cachedTaskDetailLocation, findCachedTaskDetail, openCachedTaskDetail, type CachedTaskDetailLocation } from "@/lib/navigation/cachedTaskDetail";

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
  const [historyDestination, setHistoryDestination] = useState<{ pathname: string } | null>(null);
  const pathname = usePathname();
  const queryClient = useQueryClient();
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
      const sourcePath = location ? `/detail/project-${location.projectId}/${location.uniqueIndex}` : pathname;
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
  }, [location, accountId, router]);
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
    if (!historyDestination || accountId === null || currentUser?.id !== accountId) return;
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
      setHistoryDestination(null);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(restoreDestination);
    restoreDestination();
    return unsubscribe;
  }, [historyDestination, accountId, currentUser?.id, queryClient]);
  if (!showDetail && backFirstOpen && instantTicketOpen && currentUser?.id === accountId &&
      historyDestination?.pathname === nativePathname) {
    return (
      <>
        <div hidden>{children}</div>
        <div role="status" data-task-path={historyDestination.pathname} className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
          Loading task…
        </div>
      </>
    );
  }
  // A Suspense fallback would remount the board and replay its startup navigation.
  if (backFirstOpen && showDetail && !EmbeddedTaskDetail) return null;
  if (!showDetail || !EmbeddedTaskDetail) return children;
  return (
    <EmbeddedTaskDetail
      key={`${location.accountId}:${location.taskId}`}
      taskId={location.taskId}
      projectId={location.projectId}
      uniqueIndex={location.uniqueIndex}
      initialTask={task}
      embedded={false}
    />
  );
}
