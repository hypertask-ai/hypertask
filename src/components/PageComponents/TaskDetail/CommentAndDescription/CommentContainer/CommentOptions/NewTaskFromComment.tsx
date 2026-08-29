import React from "react";
import { useMemo } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Plus } from "lucide-react";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import { IAttachment, IComment, ITask } from "@/models/model";
import taskDetailConfig from "@/lib/configs/taskDetail.config";

interface IProps {
  task: ITask | null;
  currentIndex: number;
  comment: IComment;
}

const NewTaskFromComment: React.FC<IProps> = ({
  comment,
  task,
  currentIndex,
}) => {
  const { toggleCreateTaskGlobally } = useHypertasksRecoilStates();

  const className = useMemo(
    () =>
      "cursor-pointer fill-icon-dark-gray hover:fill-white-black transition-[transform,fill] ease-in-out duration-100 scale-0 group-hover:scale-100 rounded-lg xs:mb-[5px] sm:mb-0",
    []
  );

  //for processing comment attachments if any when creating new task from comment
  const processAttachmentsForNewTask = (attachments?: IAttachment[]) => {
    if (!attachments || attachments.length === 0) return [];
    let temp: any[] = [];
    for (const attachment of attachments) {
      temp.push({
        file: {
          name: attachment.fileName,
          size: attachment.fileSize,
          source: attachment.fileSource,
          type: attachment.fileType,
        },
        id: attachment.id,
      });
    }
    console.log("🚀 ~ processAttachmentsForNewTask ~ temp:", temp);
    return temp;
  };

  const toggleCreateSubTask = () => {
    if (!comment || !task) return;

    // SECURITY: Use the shared task-detail templates so staging sanitization and the PR's mention/link escaping both apply.
    const linkhtml = taskDetailConfig.urls.templates.commentLink(
      task.projectId,
      String(task.uniqueIndex),
      task.ticketNumber ?? "",
      currentIndex
    );
    const mentionhtml = taskDetailConfig.urls.templates.mention(
      comment.creator?.displayName ?? "",
      comment.creator?.id!
    );
    const heading = `${mentionhtml} said in ${linkhtml}`;
    toggleCreateTaskGlobally({
      sectionId: task?.sectionId!,
      sectionTitle: task?.section!,
      position: "top",
      prefilledDescription: `<p>${heading}<blockquote>${comment.text}</blockquote></p>`,
      prefilledAttachments: processAttachmentsForNewTask(comment.attachments),
    });
  };

  const onClick = (e: any) => {
    e.stopPropagation();
    toggleCreateSubTask();
  };
  return (
    <Plus size={14}
      onClick={onClick}
      className={cn(className, "text-content text-white-black")}
     strokeWidth={1.75}/>
  );
};

export default NewTaskFromComment;
