import { activeItemAtom, idToDeleteCommentAtom, showCommandsAtom, showShortcutsAtom, inViewObjectAtom, showMentionListAtom, showAIChatInterfaceAtom, openAiChatByDefaultAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom, showCreateTaskModalAtom, appShellRailAtom, tasksPlayListAtom } from "@/store";

import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import useUpdateSubtask from "@/hooks/Task Detail/useUpdateSubtask";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { useHydrated } from "@/hooks/General/useHydrated";
import globalConstants from "@/lib/constants";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, type LearnTutorialDismissibleSurface } from "@/lib/tutorial/learnTutorialState";
import type { useTaskDetailStateValue } from "./useTaskDetailState";
export function useTaskDetailModals(state: useTaskDetailStateValue) {
  const { embedded, _parsedTask, createContextOptionsForHTC } = state;

  // const {data:draftsFromTQ , isLoading} =useGetDrafts(_parsedTask.id, currentUser.id)

  // console.log("🚀 ~ _currentTask:", currentTask)

  const [showEmojiPickerAtComment, setShowEmojiPickerAtCount] = useState<{
    commentId: number;
    show: boolean;
  }>();

  const [priority_, setPriority_] = useState(_parsedTask.priority ?? null);
  const [estimate_, setEstimate_] = useState(_parsedTask.estimate ?? null);
  // ----------------- STATE HANDLERS when focus NOT on task detail main components ( title, description container, comment container, mark as done, new comment container )
  const activeModals: string[] | undefined = [...taskDetailConfig.modals.active];

  const tipTapClassName: string = taskDetailConfig.classNames.tipTap;

  // =================== MODAL STATES
  const [showMoveTaskToBoard, setShowMoveTaskToBoard] =
    useState<boolean>(false);
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [showLinksModal, setShowLinksModal] = useState<boolean>(false);
  const [showPriorityModal, setShowPriorityModal] = useState(false);
  const [showEstimateModal, setShowEstimateModal] = useState(false);
  const [showCreateLabelModal, setShowCreateLabelModal] = useState(false);
  const [showDueDateModal, setShowDueDateModal] = useState(false);

  useEffect(() => {
    const dismissTutorialTaskModal = (event: Event) => {
      const surface = (
        event as CustomEvent<{ surface?: LearnTutorialDismissibleSurface }>
      ).detail?.surface;
      if (surface === "assignees") setShowAssignModal(false);
      if (surface === "priority") setShowPriorityModal(false);
    };
    window.addEventListener(
      LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT,
      dismissTutorialTaskModal
    );
    return () =>
      window.removeEventListener(
        LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT,
        dismissTutorialTaskModal
      );
  }, []);

  // To check operating system
  const isApple = useDeviceContext();

  // =================== RECOIL ROOT STATE OBJECTS
  const { resetShowCommands, toggleCreateTaskGlobally } =
    useHypertasksRecoilStates();
  const [showShortucts, setShowShortcuts] = useRecoilState(showShortcutsAtom);
  const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
  const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
  const commandContextOptions = useMemo(
    () =>
      showCommands.show ? { ...createContextOptionsForHTC() } : undefined,
    [showCommands]
  );
  const [idToDelete, setIdToDelete] = useRecoilState<any>(
    idToDeleteCommentAtom
  );
  const [activeItem, _setActiveItem] = useRecoilState(activeItemAtom);
  const [inViewObject, setInViewObject] = useRecoilState(inViewObjectAtom);
  const [showAiChatInterface, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const hydrated = useHydrated();
  const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom);
  const aiChatAutoOpenSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
  const aiChatPinned = useRecoilValue(aiChatPinnedAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(aiChatAutoOpenSuppressedAtom);
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const [showMentionList, setShowMentionList] =
    useRecoilState(showMentionListAtom);
  const showCreateTaskModal = useRecoilValue(showCreateTaskModalAtom);
  const { callBackHandlerSubtaskLinking, callBackHandlerRemoveSubtask } =
    useUpdateSubtask();
  const { goToProjectShortcut, updateCommentsActivityQuery } =
    useProjectQuery();
  const { startNewSession, editor: aiChatEditor } = useOptionalAiChatContext() ?? {};
  const { copyCommentToAiChat, summarizeComment, summarizeTicket } = useCommentToAiChat();

  const _mbl = useContext(MobileViewContext);
  const initialScrollViewportRef = useRef({
    taskId: _parsedTask.id,
    isMobile: _mbl,
  });
  const appShellRailOn =
    useRecoilValue(appShellRailAtom) && !_mbl && !embedded;

  // Pinning always opens chat. Otherwise, the default setting opens it unless
  // a manual close suppressed auto-open or the task is shown on mobile.
  useEffect(() => {
    // The state adapter exposes SSR defaults until this consumer has hydrated.
    if (
      !hydrated ||
      _mbl ||
      (!aiChatPinned && (!openAiChatByDefault || aiChatAutoOpenSuppressed))
    ) return;
    setShowAiChatInterface(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    _parsedTask?.id,
    openAiChatByDefault,
    aiChatAutoOpenSuppressed,
    aiChatPinned,
    _mbl,
  ]);
  // const dummy = useRef<HTMLElement | null>(null);
  const controller: { [key: number]: { pressed: boolean } } = {
    ...globalConstants.multipleKeys,
  };
  return { showEmojiPickerAtComment, setShowEmojiPickerAtCount, priority_, setPriority_, estimate_, setEstimate_, activeModals, tipTapClassName, showMoveTaskToBoard, setShowMoveTaskToBoard, showMoveModal, setShowMoveModal, showDropdown, setShowDropdown, showAssignModal, setShowAssignModal, showLinksModal, setShowLinksModal, showPriorityModal, setShowPriorityModal, showEstimateModal, setShowEstimateModal, showCreateLabelModal, setShowCreateLabelModal, showDueDateModal, setShowDueDateModal, isApple, resetShowCommands, toggleCreateTaskGlobally, showShortucts, setShowShortcuts, showCommands, setShowCommands, setTasksPlayList, commandContextOptions, idToDelete, setIdToDelete, activeItem, _setActiveItem, inViewObject, setInViewObject, showAiChatInterface, setShowAiChatInterface, openAiChatByDefault, aiChatAutoOpenSuppressed, aiChatPinned, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, showMentionList, setShowMentionList, showCreateTaskModal, callBackHandlerSubtaskLinking, callBackHandlerRemoveSubtask, goToProjectShortcut, updateCommentsActivityQuery, startNewSession, aiChatEditor, copyCommentToAiChat, summarizeComment, summarizeTicket, _mbl, initialScrollViewportRef, appShellRailOn, controller };
}

export type useTaskDetailModalsValue = ReturnType<typeof useTaskDetailModals>;
