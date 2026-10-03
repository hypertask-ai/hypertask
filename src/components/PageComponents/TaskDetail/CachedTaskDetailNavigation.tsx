"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { ITask } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";
import EmbeddedTaskDetail from "@/components/Modals/SwipeUnread/EmbeddedTaskDetail";
import { cachedTaskDetailKey, cachedTaskDetailLocation, type CachedTaskDetailLocation } from "@/lib/navigation/cachedTaskDetail";

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
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton"),
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions"),
  import("@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions"),
  import("@/components/PageComponents/TaskDetail/TaskMovement"),
  import("@/components/RTE/Extensions/lazyEmojiData").then(({ ensureEmojiData }) => ensureEmojiData()),
]);

export default function CachedTaskDetailNavigation({ children, accountId }: {
  children: ReactNode;
  accountId: number | null;
}) {
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const router = useRouter();
  const currentUser = useRecoilValue(currentUserAtom);
  const previousLocation = useRef<CachedTaskDetailLocation | undefined>(undefined);
  // Cached opens retain Next's source tree, so popstate must update the view independently.
  const nativePathname = useSyncExternalStore(subscribeToLocation, browserPathname, serverPathname);
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
    if (!location) return;
    const restoreSourceRoute = (event: PopStateEvent) => {
      if (!event.state?.__NA || !event.state?.__PRIVATE_NEXTJS_INTERNALS_TREE ||
          cachedTaskDetailLocation(window.location.pathname, accountId, event.state)) return;
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
    let warming = false;
    const warm = () => {
      if (warming) return;
      warming = true;
      // Import only: no ticket requests, editor mounts or permission prompts.
      void warmTaskDetail().catch(() => { warming = false; });
    };
    // Start after board commit, not at idle: the first click may beat the idle callback.
    warm();
    document.addEventListener("pointerdown", warm, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", warm, true);
  }, [instantTicketOpen, accountId, currentUser?.id, pathname]);
  const task = location && queryClient.getQueryData<ITask>(
    cachedTaskDetailKey(location.accountId, location.taskId),
  );
  useEffect(() => {
    if (location && !task) router.replace(window.location.pathname + window.location.search + window.location.hash);
  }, [location, task, router]);
  if (!instantTicketOpen || !location || !task || task.projectId !== location.projectId || task.uniqueIndex !== location.uniqueIndex) return children;
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
