"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useGetNotifications } from "@/hooks/Inbox/useGetNotifications";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7311_DECISION_COMMENT_LINK_FLAG } from "@/lib/flags/keys";
import { HTPR_7801_INBOX_VISIBLE_ORDER_FLAG } from "@/lib/flags/definitions/htpr-7801-inbox-visible-order";
import { decisionsSplitName } from "@/lib/configs/inbox.config";
import {
  buildInboxTasksPlaylist,
  inboxPlaylistHoldsTask,
  pickInboxPlaylistSplit,
} from "@/lib/inbox/inboxTasksPlaylist";
import { tasksPlayListAtom } from "@/store";
import { useRecoilState } from "@/lib/state";

type Props = {
  userId: number;
  task: { projectId: number; uniqueIndex: number };
};

const InboxPlaylistRestorer = ({ userId, task }: Props) => {
  const { data } = useGetNotifications(userId);
  const decisionCommentLinkEnabled = useFlag(HTPR_7311_DECISION_COMMENT_LINK_FLAG);
  const inboxVisibleOrder = useFlag(HTPR_7801_INBOX_VISIBLE_ORDER_FLAG);
  const [tasksPlayList, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const split = useSearchParams()?.get("split");
  const structuredData = data?.structuredData;

  useEffect(() => {
    if (inboxPlaylistHoldsTask(tasksPlayList, task)) return;
    const picked = pickInboxPlaylistSplit(structuredData, task, split);
    if (!picked) return;
    setTasksPlayList(
      buildInboxTasksPlaylist(
        picked.notifications,
        decisionCommentLinkEnabled && picked.splitName === decisionsSplitName,
        inboxVisibleOrder ? { oldestFirst: picked.splitName === "Blocked by you" } : undefined,
      ),
    );
  }, [structuredData, tasksPlayList, task.projectId, task.uniqueIndex, split, decisionCommentLinkEnabled, inboxVisibleOrder]);

  return null;
};

export default InboxPlaylistRestorer;
