import "@/styles/attachmentUpload.scss";
import { useTaskDetailEditorState, type TiptapProps } from "./useTaskDetailEditorState";
import { useTaskDetailEditorDrafts } from "./useTaskDetailEditorDrafts";
import type { TaskDetailEditorContext } from "./TaskDetailEditorContext";
import { taskDetailEditorPresentation } from "./taskDetailEditorPresentation";
import { TaskDetailEditorPanels } from "./TaskDetailEditorPanels";
import { useTaskDetailEditorSave } from "./useTaskDetailEditorSave";
import { useTaskDetailEditorKeyboard } from "./useTaskDetailEditorKeyboard";
import { useTaskDetailEditorWriter } from "./useTaskDetailEditorWriter";
import { useTaskDetailEditorFocus } from "./useTaskDetailEditorFocus";
import { useTaskDetailEditorEvents } from "./useTaskDetailEditorEvents";

const Tiptap = (props: TiptapProps) => {
  const state = useTaskDetailEditorState(props);
  const drafts = useTaskDetailEditorDrafts(state);
  const context = { ...state, ...drafts } as TaskDetailEditorContext;
  Object.assign(context, useTaskDetailEditorSave(() => context));
  Object.assign(context, useTaskDetailEditorKeyboard(() => context));
  Object.assign(context, useTaskDetailEditorWriter(() => context));
  const presentation = { ...context, ...taskDetailEditorPresentation(context) };
  useTaskDetailEditorFocus(presentation);
  useTaskDetailEditorEvents(presentation);
  return TaskDetailEditorPanels(presentation);
};

export default Tiptap;
