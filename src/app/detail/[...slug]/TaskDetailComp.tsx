"use client";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG } from "@/lib/flags/keys";
import { useEffect, useRef } from "react";
import { useRecoilValue } from "@/lib/state";
import { inViewObjectAtom } from "@/store";
import { isEmptyComposeTarget } from "@/lib/ai/composeTaskTarget";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
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
  const ctrlJSidebarOnNewTask = useFlag(HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG);
  const { editTicketWithAi } = useCommentToAiChat();
  const state = useTaskDetailState(props);
  const modals = useTaskDetailModals(state);
  const { currentTask, isRecording } = state;
  const { isApple } = modals;
  const inViewObject = useRecoilValue(inViewObjectAtom);
  const newTaskAiOpened = useRef<number | null>(null);
  useEffect(ctrlJSidebarOnNewTask ? () => {
    if (props.embedded || !currentTask || currentTask.id <= 0 || state.searchParams?.get("newTaskAi") !== "1" || newTaskAiOpened.current === currentTask.id) return;
    if (inViewObject?.taskId !== currentTask.id || window.location.pathname !== `/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`) return;
    newTaskAiOpened.current = currentTask.id;
    const params = new URLSearchParams(state.searchParams.toString());
    params.delete("newTaskAi");
    state.router.replace(`${window.location.pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    void editTicketWithAi(currentTask.id);
  } : () => {}, [ctrlJSidebarOnNewTask, props.embedded, currentTask, state.searchParams, state.router, inViewObject?.taskId, editTicketWithAi]);
  useEffect(ctrlJSidebarOnNewTask ? () => {
    if (props.embedded || !currentTask || currentTask.id <= 0 || !isEmptyComposeTarget(currentTask)) return;
    const openNewTaskSidebar = (event: KeyboardEvent) => {
      const cmdControl = (isApple && event.metaKey) || (!isApple && event.ctrlKey);
      if (event.key.toLowerCase() !== "j" || !cmdControl || event.shiftKey || event.altKey || event.isComposing || isRecording) return;
      if (document.querySelector(".modal, [role='dialog'], #htc") || document.activeElement?.closest(".chatwindow, [data-ai-chat-panel]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void editTicketWithAi(currentTask.id);
    };
    document.addEventListener("keydown", openNewTaskSidebar, true);
    return () => document.removeEventListener("keydown", openNewTaskSidebar, true);
  } : () => {}, [ctrlJSidebarOnNewTask, props.embedded, currentTask, isApple, isRecording, editTicketWithAi]);
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
