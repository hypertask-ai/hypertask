
import type { EditorAttachmentStateItem } from "./useTaskDetailEditorState";
import type { Content } from "@tiptap/core";
import { Node, Fragment } from "@tiptap/pm/model";

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TaskDetailEditorDraftState } from "./useTaskDetailEditorDrafts";
export type TaskDetailEditorContext = TaskDetailEditorDraftState & TaskDetailEditorHandlers;
export interface TaskDetailEditorHandlers {
  toggleHighlightHandler: (state: boolean) => void;
  handleCallback: (mode_?: "moveToNext", inbox?: boolean, markAsDone?: boolean) => Promise<boolean | undefined>;
  sendComment: (alwaysAdvance?: boolean) => Promise<boolean | undefined>;
  toggleAiTaskWriter: () => void;
  audioTiptapCallback: (text: string, setContent?: boolean) => void;
  getAttachments: (files: File[]) => Promise<void>;
  cancelMobileExistingEdit: () => void;
  handleCommentEscape: () => void;
  handleKeydown: (e: any) => void;
  resetDropFiles: () => void;
  handleFileDrop: (droppedFiles: FileList) => Promise<void>;
  handleFocus: (forceFocus?: any) => false | undefined;
  handleOutsideClickDescription: () => void;
  handleOutsideClickComment: () => void;
  calculatePopoverPosition: (targetDiv: HTMLElement, popover: HTMLElement) => void;
  updateTaskTitleDescription: (value: string, description: string) => Promise<void>;
  handleEscape: () => void;
  setLinkHandlerCallback: (task?: any, keyword?: string) => void;
  handleAISave: (content: Node | Content | Fragment, attachments?: AIGeneratedAttachment[], preserveExistingAttachments?: boolean) => (EditorAttachmentStateItem | { id: number; file: { id: string; createdAt: string; type: string; source: string; name: string; size: string; taskId: null; }; })[];
  handleTitleAndDescriptionReturn: (title: string, description: string) => void;
  getDefaultMode: () => "AiTaskWriter" | "WriteWithAI";
}
