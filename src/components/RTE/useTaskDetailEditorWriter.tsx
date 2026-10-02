
import { updateTask } from "@/utils/api/Task Detail";
import toast from "react-hot-toast";
import type { Content } from "@tiptap/core";
import { Node, Fragment } from "@tiptap/pm/model";
import { mergeDescriptionTakeoverAttachments } from "@/lib/ai/autoDescriptionSuggestion";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
export function useTaskDetailEditorWriter(getContext: () => TaskDetailEditorContext) {
  const { currentTask, router, updateDrafts, setShouldShowAITaskWriter, editor, setAiTriggerData, setShowSetLinkModal, newCommentAttachments, setNewCommentAttachments, setTrigger, mode } = getContext();


  const calculatePopoverPosition = (targetDiv: HTMLElement, popover: HTMLElement) => {
    const popoverHeight = popover.offsetHeight;
    console.log("Size ===> new min height", popoverHeight + 30);
    targetDiv.style.minHeight = `${popoverHeight + 30}px`;
  };

  const updateTaskTitleDescription = async (value: string, description: string) => {
    try {
      const newTask = { title: value, id: currentTask?.id };
      if (value) {
        const response = await updateTask(newTask);
        if (response.status === 200) {
          router.refresh();
          toast("Task title updated!");
        }
      }
    } catch (error) {
      console.log("🚀 ~ updateTaskTitle ~ error:", error);
    } finally {
      updateDrafts(description);
    }
  };

  // AI Task Writer handlers
  const handleEscape = () => {
    const { handleFocus } = getContext();
    setShouldShowAITaskWriter(false);
    editor?.commands.unsetHighlight();
    handleFocus(true);
    setAiTriggerData({ initialPrompt: "", autoTrigger: false });
  };

  function setLinkHandlerCallback(task?: any, keyword?: string) {
    setShowSetLinkModal(false);
    console.log("🚀 ~ setLinkHandlerCallback ~ task:", task, keyword);

    let urlToSet: string = "";

    if (task) {
      // Generate URL for the task: /detail/project-${projectId}/${uniqueIndex}
      urlToSet = `/detail/project-${task.projectId}/${task.uniqueIndex}`;
    } else if (keyword) {
      // Check if keyword is a valid URL
      const trimmedKeyword = keyword.trim();

      // Check if it's already a valid absolute URL (http://, https://)
      if (trimmedKeyword.startsWith("http://") || trimmedKeyword.startsWith("https://")) {
        try {
          new URL(trimmedKeyword);
          urlToSet = trimmedKeyword;
        } catch {
          // Invalid URL format
          urlToSet = "";
        }
      }
      // Check if it's a relative URL (starts with /)
      else if (trimmedKeyword.startsWith("/")) {
        urlToSet = trimmedKeyword;
      }
      // Check if it looks like a domain (contains .)
      else if (trimmedKeyword.includes(".") && !trimmedKeyword.includes(" ")) {
        try {
          // Try to validate as URL with http:// prefix
          new URL(`http://${trimmedKeyword}`);
          urlToSet = `http://${trimmedKeyword}`;
        } catch {
          // Not a valid domain, treat as text
          urlToSet = "";
        }
      }
      // Otherwise, it's likely just text, not a URL
      else {
        urlToSet = "";
      }
    }

    if (urlToSet) {
      editor?.chain().focus().extendMarkRange("link").setLink({ href: urlToSet }).unsetHighlight().run();
    }
  }

  const handleAISave = (
    content: Node | Content | Fragment,
    attachments?: AIGeneratedAttachment[],
    preserveExistingAttachments = false,
  ) => {
    const { handleFocus } = getContext();
    editor?.commands.setContent(content);

    // Map AI attachments to match FileItem structure: { id, file }
    // where file contains the attachment properties
    const mappedAttachments = attachments?.map((attachment, idx) => ({
      id: idx,
      file: {
        id: attachment.id || `ai-${idx}`,
        createdAt: new Date().toISOString(),
        type: attachment.file.type,
        source: attachment.preview, // S3 URL from the uploaded attachment
        name: attachment.file.name,
        size: attachment.file.size.toString(),
        taskId: null, // AI generated attachments don't have a taskId yet
      }
    })) || [];
    const attachmentsToSave = preserveExistingAttachments
      ? mergeDescriptionTakeoverAttachments(
          newCommentAttachments,
          mappedAttachments,
        )
      : mappedAttachments;

    console.log("🚀 ~ AI attachments mapped for TipTap:", mappedAttachments);
    setNewCommentAttachments(attachmentsToSave);
    setTrigger(prev => !prev);
    setShouldShowAITaskWriter(false);
    editor?.commands.unsetHighlight();
    handleFocus(true);
    setAiTriggerData({ initialPrompt: "", autoTrigger: false });
    return attachmentsToSave;
  };

  const handleTitleAndDescriptionReturn = (title: string, description: string) => {
    updateTaskTitleDescription(title, description);
  };

  const getDefaultMode = () => {
    return mode === "read-edit-description" ? "AiTaskWriter" : "WriteWithAI";
  };
  return { calculatePopoverPosition, updateTaskTitleDescription, handleEscape, setLinkHandlerCallback, handleAISave, handleTitleAndDescriptionReturn, getDefaultMode };
}
