"use client";

import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import type { ITask } from "@/models/model";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";
import EmbeddedTaskDetail from "@/components/Modals/SwipeUnread/EmbeddedTaskDetail";
import { cachedTaskDetailKey, cachedTaskDetailLocation, type CachedTaskDetailLocation } from "@/lib/navigation/cachedTaskDetail";

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
  // Next can replace custom history state while refreshing the same route.
  const location = cachedTaskDetailLocation(
    pathname,
    instantTicketOpen && currentUser?.id === accountId ? accountId : null,
    typeof window === "undefined" ? null : {
      cachedTaskDetail: window.history.state?.cachedTaskDetail ?? previousLocation.current,
    },
  );
  previousLocation.current = location;
  const task = location && queryClient.getQueryData<ITask>(
    cachedTaskDetailKey(location.accountId, location.taskId),
  );
  useEffect(() => {
    if (location && !task) router.replace(window.location.pathname + window.location.search + window.location.hash);
  }, [location, task, router]);
  if (!location || !task || task.projectId !== location.projectId || task.uniqueIndex !== location.uniqueIndex) return children;
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
