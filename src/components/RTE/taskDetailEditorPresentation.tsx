// Tiptap.tsx
import { type MouseEvent as ReactMouseEvent } from "react";
import { ITaskLabel } from "@/models/model";
import { isContentCarouselImage } from "@/utils/helperFunctions/isContentCarouselImage";
import { buildTaskWriterAutoDraftPrompt, resolveTaskDetailWriterOpening, resolveTaskWriterDescription } from "@/lib/ai/taskWriterAutoDraft";
import { isInternalTaskDetailHref, preserveInboxFlowOnTaskHref, shouldFollowLinkNatively } from "@/lib/taskDetailInboxFlow";

const generateAttachmentFromImgEl = (img: HTMLImageElement, idx: number) => ({
  id: idx + 1,
  createdAt: -1,
  fileType: "image/png",
  taskId: 1,
  fileSource: img.src,
  fileName: "Image.png",
});

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function taskDetailEditorPresentation(context: TaskDetailEditorContext) {
  const { shouldShowAiTaskWriter, getDefaultMode, mobileExistingEditOpen, shouldShowInlineDraftAiRef, mode, editor, defaultContent, currentTask, editorContent, aiTriggerData, isReadOnlyContent, setCarousalItems, carouselAttachments, attachments, router, inboxFlow } = context;

  const shouldShowInlineDraftAi = Boolean(
    shouldShowAiTaskWriter && getDefaultMode() === "WriteWithAI"
  ) || Boolean(shouldShowAiTaskWriter && mobileExistingEditOpen);
  shouldShowInlineDraftAiRef.current = shouldShowInlineDraftAi;
  const shouldShowFullAiTaskWriter =
    shouldShowAiTaskWriter && !shouldShowInlineDraftAi;
  const getAdditionalContext = () => mode === "read-edit-description"
    ? "You have to write your response in a manner thats well suited to be in a task description"
    : "You have to write your response in a manner thats well suited to add as a comment or when replying to a thread";
  const taskWriterDescription = resolveTaskWriterDescription(
    editor?.getHTML(),
    defaultContent,
    currentTask.description_?.content,
    editorContent,
  );
  const getBackgroundContent = () => taskWriterDescription;
  const autoDraftPrompt =
    mode === "read-edit-description"
      ? buildTaskWriterAutoDraftPrompt({
          title: currentTask.title,
          description: taskWriterDescription,
          tags: currentTask.taskLabels?.map(
            (taskLabel: ITaskLabel) => taskLabel.label,
          ),
          priority: currentTask.priority,
          estimate: currentTask.estimate,
        })
      : null;
  const taskWriterOpening = resolveTaskDetailWriterOpening(
    aiTriggerData.autoTrigger,
    aiTriggerData.initialPrompt,
    autoDraftPrompt,
  );

  const handleReadOnlyContentClick = (
    event: ReactMouseEvent<HTMLDivElement>
  ) => {
    if (!isReadOnlyContent) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    // The Figma thumbnail is a button, not an inline attachment. Let its
    // NodeView swap in the live iframe instead of opening the image carousel.
    if (target.closest("[data-figma-embed-preview]")) return;

    const image = target.closest("img");
    if (image instanceof HTMLImageElement) {
      const images = Array.from(
        event.currentTarget.querySelectorAll<HTMLImageElement>(".ProseMirror img")
      ).filter(isContentCarouselImage);
      const currentIndex = images.indexOf(image);
      if (currentIndex < 0) return;

      setCarousalItems({
        attachments: [
          ...images.map(generateAttachmentFromImgEl),
          ...(carouselAttachments ?? attachments ?? []),
        ],
        currentIndex,
      });
      return;
    }

    const link = target.closest("a");
    const href = link?.getAttribute("href");
    if (href && isInternalTaskDetailHref(href)) {
      if (shouldFollowLinkNatively(event)) return;
      event.preventDefault();
      router.push(preserveInboxFlowOnTaskHref(href, inboxFlow));
    }
  };
  return { shouldShowInlineDraftAi, shouldShowFullAiTaskWriter, getAdditionalContext, taskWriterDescription, getBackgroundContent, autoDraftPrompt, taskWriterOpening, handleReadOnlyContentClick };
}
export type TaskDetailEditorPresentation = TaskDetailEditorContext & ReturnType<typeof taskDetailEditorPresentation>;
