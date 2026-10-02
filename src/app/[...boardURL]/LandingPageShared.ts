import { IProject, IUser } from "@/models/model";
import { lazy, useLayoutEffect, useState } from "react";
import { TBoardSortingViewMode } from "@/models/Views/model";
import { type BoardReadinessTraceScope, getBoardReadinessTraceScope, prepareBoardReadinessTrace } from "@/lib/analytics/boardReadinessPhases";



// React.lazy calls import() only when the conditional branch actually renders.
// next/dynamic preloads client boundaries from this route even while closed.
export const TrialModal = lazy(
  () => import("@/components/Modals/TrialPlan/TrialModal"),
);

export const TableView = lazy(
  () => import("@/components/PageComponents/Kanban/TableView/TableView"),
);

export const Header = lazy(
  () => import("@/components/PageComponents/Kanban/HeaderComponents/header"),
);

export const ViewTabsBar = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar"),
);

export const AppShellRail = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/AppShellRail"),
);

export const ShellViewControls = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/ShellViewControls"),
);

export const GuestAuthLinks = lazy(
  () =>
    import("@/components/PageComponents/Kanban/HeaderComponents/GuestAuthLinks"),
);


export const EMPTY_NOTIFICATION_COUNT = { all: 0, unseen: 0 } as const


export type BoardRenderSnapshot = {
  accountId: number;
  projects: IProject[];
  projectIndex: number;
  activeSortingMode: TBoardSortingViewMode;
  boardLayout: "board" | "table";
  readinessSource: "indexeddb" | "network" | "unknown";
  readinessProjectId: number;
  readinessRouteEntryId: number;
};


export const useCommittedBoardReadinessTrace = ({
  accountId,
  projectId,
  routeEntryId,
}: {
  accountId: number;
  projectId: number | null;
  routeEntryId: number;
}): BoardReadinessTraceScope | null => {
  const [scope, setScope] = useState<BoardReadinessTraceScope | null>(null)

  useLayoutEffect(() => {
    if (projectId === null) {
      setScope(null)
      return
    }

    prepareBoardReadinessTrace({ accountId, projectId, routeEntryId })
    setScope(getBoardReadinessTraceScope())
  }, [accountId, projectId, routeEntryId])

  if (
    scope?.accountId !== accountId ||
    scope.projectId !== projectId ||
    scope.routeEntryId !== routeEntryId
  ) {
    return null
  }
  return scope
}


export type LandingPageInput = { user: IUser; authenticated: boolean; slugsProp: any };
