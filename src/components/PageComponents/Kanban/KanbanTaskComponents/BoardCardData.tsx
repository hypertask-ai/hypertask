"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useGetUserDrafts } from "@/hooks/General/useGetUserDrafts";
import { useBoardRunningTimers } from "@/hooks/Task Detail/useTimeTracking";
import type { IProject } from "@/models/model";

type BoardRunningTimers = ReturnType<typeof useBoardRunningTimers>;

export type BoardCardData = {
  projectId: number;
  draftTaskIds: ReadonlySet<number>;
  showTimeTotals: boolean;
  runningTimers: BoardRunningTimers["timers"];
  timeTotals: BoardRunningTimers["timeTotals"];
};

const BoardCardDataContext = createContext<BoardCardData | null>(null);

export function BoardCardDataProvider({ project, enabled, children }: { project: IProject; enabled: boolean; children: ReactNode }) {
  const [shared] = useState(enabled);
  const currentUser = useRecoilValue(currentUserAtom);
  const { draftTaskIds } = useGetUserDrafts(shared ? currentUser?.id : undefined);
  const { showTimeTotals, timers, timeTotals } = useBoardRunningTimers(project.id, {
    enabled: shared,
    project,
  });
  const value = useMemo<BoardCardData | null>(
    () =>
      shared
        ? { projectId: project.id, draftTaskIds, showTimeTotals, runningTimers: timers, timeTotals }
        : null,
    [shared, project.id, draftTaskIds, showTimeTotals, timers, timeTotals],
  );
  return <BoardCardDataContext.Provider value={value}>{children}</BoardCardDataContext.Provider>;
}

export function useBoardCardData(projectId: number, enabled: boolean): BoardCardData | null {
  const shared = useContext(BoardCardDataContext);
  return enabled && shared?.projectId === projectId ? shared : null;
}
