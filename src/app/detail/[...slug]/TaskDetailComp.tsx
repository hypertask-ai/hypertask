"use client";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7337_EDIT_WITH_AI_FLAG } from "@/lib/flags/keys";
import "@/styles/taskDetail.scss";
import { useTaskDetailState } from "./useTaskDetailState";
import { useTaskDetailModals } from "./useTaskDetailModals";
import { useTaskDetailNavigationActions } from "./useTaskDetailNavigationActions";
import { useTaskDetailCommandActions } from "./useTaskDetailCommandActions";
import { useTaskDetailCommentActions } from "./useTaskDetailCommentActions";
import { useTaskDetailModalActions } from "./useTaskDetailModalActions";
import type { TaskDetailContext } from "./TaskDetailContext";
import { createTaskDetailKeyboard } from "./taskDetailKeyboard";
import { useTaskDetailInitialScroll } from "./useTaskDetailInitialScroll";
import { useLinkedCommentScroll } from "./useLinkedCommentScroll";
import { useTaskDetailReadiness } from "./useTaskDetailReadiness";
import { TaskDetailPanels } from "./TaskDetailPanels";
import type { TaskDetailProps } from "./useTaskDetailState";
const TaskDetail: React.FC<TaskDetailProps> = (props) => {
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const state = useTaskDetailState(props);
  const modals = useTaskDetailModals(state);
  const context = { ...props, ...state, ...modals } as TaskDetailContext;
  Object.assign(context, useTaskDetailNavigationActions(() => context));
  Object.assign(context, useTaskDetailCommandActions(() => context));
  Object.assign(context, useTaskDetailCommentActions(() => context));
  Object.assign(context, useTaskDetailModalActions(() => context));
  const keyboard = editWithAiEnabled
    ? createTaskDetailKeyboard(context, true)
    : createTaskDetailKeyboard(context, false);
  const keyboardContext = { ...context, ...keyboard };
  const effects0 = useTaskDetailInitialScroll(keyboardContext);
  useLinkedCommentScroll(keyboardContext);
  useTaskDetailReadiness({ ...keyboardContext, ...effects0 });
  return TaskDetailPanels(context);
};

export default TaskDetail;
