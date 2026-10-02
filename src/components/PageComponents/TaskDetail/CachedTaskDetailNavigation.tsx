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
  const instantTicketOpen = useFlag(
    HTPR_6752_INSTANT_TICKET_OPEN_FLAG,
  );
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
    if (!instantTicketOpen || accountId === null || currentUser?.id !== accountId ||
        !["/project", "/my-tasks", "/inbox"].includes(pathname)) return;
    let warming = false;
    const warm = () => {
      if (warming) return;
      warming = true;
      // Import only: no ticket requests, editor mounts or permission prompts.
      void warmTaskDetail().catch(() => { warming = false; });
    };
    const idle = "requestIdleCallback" in window;
    const handle = idle ? window.requestIdleCallback(warm, { timeout: 1000 }) : window.setTimeout(warm, 150);
    document.addEventListener("pointerdown", warm, { capture: true, passive: true });
    return () => {
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      document.removeEventListener("pointerdown", warm, true);
    };
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
