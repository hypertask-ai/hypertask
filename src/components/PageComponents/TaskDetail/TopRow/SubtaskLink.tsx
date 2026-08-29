import React from "react";
import Link from "next/link";
import { ITask } from "@/models/model";
import useUpdateSubtask from "@/hooks/Task Detail/useUpdateSubtask";
import { Unlink } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";
import { cn } from "@/utils/undoActions/helperFuncs";

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
  if (!parentTask) {
    return null;
  }
  return (
    <span className={cn("mt-2  sm:pb-0 pb-2 text-icon-dark-gray text-dense flex items-center flex-wrap", className)}>
      Sub-task of&nbsp;
      <Link
        href={`/detail/project-${projectId}/${parentTask.uniqueIndex}`}
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
