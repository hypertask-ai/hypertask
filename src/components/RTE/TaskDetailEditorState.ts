

type AIGeneratedAttachment = {
  id?: string;
  file: Pick<File, "name" | "size" | "type">;
  preview: string;
};
import type { TiptapProps, useTaskDetailEditorStateValue } from "./useTaskDetailEditorState";
export type TaskDetailEditorState = TiptapProps & useTaskDetailEditorStateValue;
