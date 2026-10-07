import React from "react";
import Link from "next/link";
import { ITask } from "@/models/model";
import useUpdateSubtask from "@/hooks/Task Detail/useUpdateSubtask";
import { Unlink } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useSearchParams } from "next/navigation";
import { preserveInboxFlowOnTaskHref, shouldFollowLinkNatively } from "@/lib/taskDetailInboxFlow";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/General/useAuth";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG, HTPR_6972_SUBTASK_LINK_FLAG } from "@/lib/flags/keys";
import { openCachedTaskDetail } from "@/lib/navigation/cachedTaskDetail";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";

interface SubTaskLinkProps {
  parentTask?: ITask | null;
  projectId?: number;
  className?: string;
}

const SubTaskLink: React.FC<SubTaskLinkProps> = ({
  parentTask,
  projectId,
  className="",
}) => {
  const { callBackHandlerRemoveParent } = useUpdateSubtask()
  const inboxFlow = useSearchParams()?.get("inboxFlow");
  const queryClient = useQueryClient();
  const { authenticatedUserId } = useAuth();
  const currentUser = useRecoilValue(currentUserAtom);
  const subtaskLink = useFlag(HTPR_6972_SUBTASK_LINK_FLAG);
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  if (!parentTask) {
    return null;
  }
  return (
    <span className={cn("mt-2  sm:pb-0 pb-2 text-icon-dark-gray text-dense flex items-center flex-wrap", className)}>
      Sub-task of&nbsp;
      <Link
        href={preserveInboxFlowOnTaskHref(
          `/detail/project-${projectId}/${parentTask.uniqueIndex}`,
          inboxFlow,
        )}
        onClick={(event) => {
          if (!subtaskLink || !instantTicketOpen || event.defaultPrevented || shouldFollowLinkNatively(event) ||
              !currentUser?.id || authenticatedUserId !== currentUser.id || projectId === undefined) return;
          if (openCachedTaskDetail({
            queryClient, accountId: currentUser.id, projectId, uniqueIndex: parentTask.uniqueIndex,
            task: parentTask, href: event.currentTarget.getAttribute("href")!,
          })) event.preventDefault();
        }}
        className="text-hypertasks-header-blue font-medium hover:underline cursor-pointer"
      >
        {parentTask.ticketNumber}&nbsp;{parentTask.title}
      </Link>
      &nbsp;

      <span
        className="relative group cursor-pointer inline-flex items-center text-white-black"
        onClick={callBackHandlerRemoveParent}
      >
        <Tooltip
          left={-44}
          bottom={-40}
          text="Unlink task from parent"
          keyCombination={[]}
        />
        <Unlink className="text-icon-hover-gray hover:text-white-black" size={11}  strokeWidth={1.75}/>
      </span>
    </span>

  );
};

export default SubTaskLink;
