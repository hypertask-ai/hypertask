"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRecoilState } from "@/lib/state";
import { globalNotificationFocusAtom } from "@/store";
import { useGetNotifications } from "@/hooks/Inbox/useGetNotifications";

export interface IInboxSplitTab {
  project: string;
  projectId?: number | null;
  length: number;
  hasUnseen: boolean;
}

/**
 * Which inbox split is active and how to switch, shared by the inbox page and
 * the mobile header strip. globalNotificationFocusAtom is the single source of
 * truth, so switching from the strip re-renders the page's active split.
 */
export const useInboxSplits = (userId: number) => {
  const router = useRouter();
  const { data: notificationsTQ } = useGetNotifications(userId);
  const [globalFocus, setGlobalFocus] = useRecoilState(
    globalNotificationFocusAtom
  );

  const tabs: IInboxSplitTab[] = notificationsTQ?.structuredData?.tabs ?? [];

  const selectSplit = useCallback(
    (index: number) => {
      const tab = notificationsTQ?.structuredData?.tabs?.[index];
      setGlobalFocus({ currSplit: index, currIdx: 0 });
      if (!tab) return;
      const projectIdParam =
        tab.projectId != null ? `&projectId=${tab.projectId}` : "";
      router.replace(`/inbox?split=${tab.project}${projectIdParam}`);
    },
    [notificationsTQ?.structuredData?.tabs, router, setGlobalFocus]
  );

  return { tabs, currSplit: globalFocus.currSplit, selectSplit };
};

export default useInboxSplits;
