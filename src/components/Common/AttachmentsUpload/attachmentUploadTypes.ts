import { IStatus, RedirectMode } from "@/models/model";
import type { Editor } from "@tiptap/react";
import { TSendBackAttachmentButton } from "@/models/CreateTaskModalModels/model";
import type { DictationCoordinator } from "@/lib/dictationCoordinator";


export interface FileItem {
  id: number;
  file: File;
}


export interface IProps {
  /** create-task-modal only: the modal's title field has text. Save must
      appear for a title-only task even though the description editor is empty. */
  hasTitle?: boolean;
  callback: (files: File[]) => void | boolean | Promise<void | boolean>;
  trigger: boolean;
  filesFromParent: any[];
  mode: RedirectMode;
  sendOnClick?: TSendBackAttachmentButton;
  editor: Editor | null;
  returnUploadedAttachments?: (attachmentsReturned: any[]) => Promise<void>;
  onFilesSelected?: (files: File[], preparation: Promise<FileItem[]>) => void;
  onUploadFailed?: (fileName: string) => void;
  inInbox?: boolean;
  handleCallback?: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  status?: IStatus;
  droppedFiles: File[];
  resetDropFiles?: () => void;
  discardDraft?: (discard: "Description" | "Comment") => void;
  showDeleteComment?: boolean;
  onCancelEditComment?: () => void;
  toggleAiTaskWriter?: () => void;
  audioTiptapCallback?: (text: string, setContent?: boolean) => void;
  audioDefaultContent?: string | undefined;
  toggleRecording?: (val: boolean) => void;
  isRecording: boolean;
  isAiTaskWriterOpen?: boolean;
  /** Hide the toolbar mic while the inline draft AI float owns dictation. */
  hideComposerDictation?: boolean;
  dictationCoordinator?: DictationCoordinator;
  mobileExistingEdit?: boolean;
  mobileEditSaving?: boolean;
  onCancelMobileEdit?: () => void;
  backgroundTaskUploads?: boolean;
}


export type AttachmentUploadInput = { props: IProps };
