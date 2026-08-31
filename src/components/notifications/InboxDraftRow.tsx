"use client";

import { useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  IUserDraft,
  USER_DRAFTS_QUERY_KEY,
} from "@/hooks/General/useGetUserDrafts";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { useRecoilState } from "@/lib/state";
import { ArchiveNotificationIcon } from "@/lib/IconsLocal";
import { tasksPlayListAtom } from "@/store";
import { commentPreview } from "@/utils/controllers/notifications/commentPreview";
import formatDateDifference from "@/utils/generateTime";
import Tooltip from "@/components/Common/Tooltip";

interface InboxDraftRowProps {
  draft: IUserDraft;
  activeDrafts: IUserDraft[];
  userId: number;
}

const InboxDraftRow = ({
  draft,
  activeDrafts,
  userId,
}: InboxDraftRowProps) => {
  const queryClient = useQueryClient();
  const { navigateToTask } = useHypertasksNavigate();
  const [, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
  const [isArchiving, setIsArchiving] = useState(false);

  const openDraft = () => {
    setTasksPlayList(
      activeDrafts.map(({ task }) => ({
        projectId: task.projectId,
        uniqueIndex: task.uniqueIndex,
      })),
    );
    navigateToTask(
      draft.task.projectId,
      draft.task.uniqueIndex,
      "push",
      "?inboxFlow=true&reply=true",
    );
  };

  const archiveDraft = async () => {
    if (isArchiving) return;

    const queryKey = USER_DRAFTS_QUERY_KEY(userId);
    const previousDrafts =
      queryClient.getQueryData<IUserDraft[]>(queryKey) ?? activeDrafts;
    const previousDraft = previousDrafts.find((item) => item.id === draft.id);

    setIsArchiving(true);
    queryClient.setQueryData<IUserDraft[]>(
      queryKey,
      previousDrafts.map((item) =>
        item.id === draft.id ? { ...item, saved: true } : item,
      ),
    );

    try {
      await axios.post("/api/drafts/archiveDraft", { draftId: draft.id });
    } catch {
      queryClient.setQueryData<IUserDraft[]>(queryKey, (currentDrafts = []) =>
        currentDrafts.map((item) =>
          item.id === draft.id && previousDraft ? previousDraft : item,
        ),
      );
      toast.error("Draft wasn’t archived. Try again.");
    } finally {
      setIsArchiving(false);
    }
  };

  const updatedAt = new Date(draft.updatedAt ?? 0);
  const archiveLabel = `Archive draft for ${draft.task.title}`;

  return (
    <div className="group/draft-row relative flex min-w-0 items-center gap-[8px] hover:bg-hoverCardBackground focus-within:bg-hoverCardBackground sm:p-inbox-horizontal md:gap-0 md:border-l-4 md:border-l-transparent md:p-0">
      <div
        aria-hidden="true"
        className="inbox-row-gutter hidden shrink-0 md:block"
      />

      <button
        type="button"
        data-inbox-draft-control="true"
        className="relative flex min-w-0 flex-1 cursor-pointer flex-col justify-between rounded-md py-2 pr-14 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-active md:flex-row md:items-center md:space-x-8 md:px-0 md:pr-10"
        onClick={openDraft}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "e") return;
          event.preventDefault();
          event.stopPropagation();
          void archiveDraft();
        }}
      >
        <span className="flex w-full min-w-0 items-center justify-between md:w-[15%] md:min-w-[15%] md:max-w-[15%] md:shrink-0">
          <span className="shrink-0 text-dense font-semibold uppercase text-green-700 dark:text-green-300">
            Draft
          </span>
          <span className="shrink-0 text-dense font-semibold text-text-light-gray md:hidden">
            {formatDateDifference(updatedAt)}
          </span>
        </span>

        <span className="mt-1 flex min-w-0 flex-1 flex-col md:mt-0 md:w-[40%] md:flex-row md:items-baseline md:gap-2 md:overflow-hidden">
          <span className="truncate text-dense font-medium text-white-black">
            {draft.task.title}
          </span>
          <span className="truncate text-dense text-text-light-gray">
            {commentPreview(draft.content, 100)}
          </span>
        </span>

        <span className="hidden min-w-[57px] shrink-0 text-dense text-text-light-gray md:block">
          {formatDateDifference(updatedAt)}
        </span>
      </button>

      <button
        type="button"
        data-inbox-draft-control="true"
        aria-label={archiveLabel}
        disabled={isArchiving}
        className="absolute right-2 flex h-11 w-11 items-center justify-center outline-none transition-opacity focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-active disabled:opacity-40 md:right-1 md:h-8 md:w-8 md:opacity-0 md:group-hover/draft-row:opacity-100 md:group-focus-within/draft-row:opacity-100"
        onClick={() => void archiveDraft()}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "e") return;
          event.preventDefault();
          event.stopPropagation();
          void archiveDraft();
        }}
      >
        <Tooltip
          text="Archive draft"
          left={-102}
          bottom={-34}
          keyCombination={["E"]}
        />
        <ArchiveNotificationIcon height={18} width={18} show={true} />
      </button>
    </div>
  );
};

export default InboxDraftRow;
