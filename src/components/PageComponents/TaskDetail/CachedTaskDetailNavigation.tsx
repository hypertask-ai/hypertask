"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ITask } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG } from "@/lib/flags/keys";
import { cachedTaskDetailKey, cachedTaskDetailLocation, findCachedTaskDetail, type CachedTaskDetailLocation } from "@/lib/navigation/cachedTaskDetail";

let loadedTaskDetail: typeof import("@/components/Modals/SwipeUnread/EmbeddedTaskDetail").default | undefined;
const loadTaskDetail = () => import("@/components/Modals/SwipeUnread/EmbeddedTaskDetail").then((module) => {
  loadedTaskDetail = module.default;
  return module;
});

const subscribeToLocation = (notify: (event: Event) => void, capture = false) => {
  window.addEventListener("popstate", notify, capture);
  window.addEventListener("cached-task-detail-navigation", notify);
  return () => {
    window.removeEventListener("popstate", notify, capture);
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
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const router = useRouter();
  const currentUser = useRecoilValue(currentUserAtom);
  const previousLocation = useRef<CachedTaskDetailLocation | undefined>(undefined);
  const [taskDetail, setTaskDetail] = useState(() => loadedTaskDetail);
  const EmbeddedTaskDetail = taskDetail ?? loadedTaskDetail;
  const historyLocation = useMemo(() => ({
    pathname: null as string | null,
    nextPathname: null as string | null,
  }), [accountId]);
  if (pathname !== historyLocation.nextPathname) {
    historyLocation.nextPathname = pathname;
    if (historyLocation.pathname !== null && typeof window !== "undefined" && pathname === browserPathname()) {
      historyLocation.pathname = null;
    }
  }
  // A history traversal owns the address until Next acknowledges it. Otherwise
  // Next Links must still render their new route before committing pushState.
  const routeLocation = useMemo(() => {
    let currentPathname = historyLocation.pathname ?? pathname;
    return {
      getSnapshot: () => historyLocation.pathname === null ? currentPathname : browserPathname(),
      subscribe: (notify: () => void) => subscribeToLocation((event) => {
        currentPathname = browserPathname();
        if (event.type === "popstate" || historyLocation.pathname !== null || !window.history.state?.cachedTaskDetail) {
          historyLocation.pathname = currentPathname;
        }
        notify();
      }, true),
    };
  }, [pathname, historyLocation]);
  const nativePathname = useSyncExternalStore(
    subtaskLink ? routeLocation.subscribe : subscribeToLocation,
    subtaskLink ? routeLocation.getSnapshot : browserPathname,
    serverPathname,
  );
  // Next can replace custom history state while refreshing the same route.
  const markedLocation = cachedTaskDetailLocation(
    nativePathname ?? pathname,
    instantTicketOpen && currentUser?.id === accountId ? accountId : null,
    typeof window === "undefined" ? null : {
      cachedTaskDetail: window.history.state?.cachedTaskDetail ?? previousLocation.current,
    },
  );
  const route = (nativePathname ?? pathname)?.match(/^\/detail\/project-(\d+)\/(\d+)$/);
  const routeTask = subtaskLink && !markedLocation && instantTicketOpen && accountId !== null && currentUser?.id === accountId && route
    ? findCachedTaskDetail(queryClient, accountId, Number(route[1]), Number(route[2]))
    : undefined;
  const location = markedLocation ?? (routeTask && accountId !== null ? {
    accountId, taskId: routeTask.id, projectId: routeTask.projectId, uniqueIndex: routeTask.uniqueIndex,
  } : undefined);
  previousLocation.current = location;
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
  const task = location && (queryClient.getQueryData<ITask>(
    cachedTaskDetailKey(location.accountId, location.taskId),
  ) ?? routeTask);
  useEffect(() => {
    if (location && !task) router.replace(window.location.pathname + window.location.search + window.location.hash);
  }, [location, task, router]);
  const showDetail = instantTicketOpen && !!location && !!task && task.projectId === location.projectId && task.uniqueIndex === location.uniqueIndex;
  useEffect(() => {
    if (!showDetail || EmbeddedTaskDetail) return;
    let cancelled = false;
    void loadTaskDetail().then(({ default: Detail }) => {
      if (!cancelled) setTaskDetail(() => Detail);
    }).catch(() => {
      if (!cancelled) router.replace(window.location.pathname + window.location.search + window.location.hash);
    });
    return () => { cancelled = true; };
  }, [showDetail, EmbeddedTaskDetail, router]);
  // A Suspense fallback would remount the board and replay its startup navigation.
  if (!showDetail || !EmbeddedTaskDetail) {
    if (subtaskLink && historyLocation.pathname !== null && nativePathname !== pathname) return null;
    return children;
  }
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
