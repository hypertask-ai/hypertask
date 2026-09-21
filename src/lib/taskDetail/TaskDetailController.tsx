"use client";

import { renderTaskDetailPanels } from "./TaskDetailPanels";
import { dispatchTaskDetailCommand } from "./taskDetailCommands";
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react/jsx-key */
/* eslint-disable react/no-danger-with-children */
// /* eslint-disable react-hooks/exhaustive-deps */
// /* eslint-disable @next/next/no-img-element */
import "@/styles/taskDetail.scss";
import { IComment, IUser, ITaskLabel, IAttachment, TaskRelations, ISection, IAssignees, ICycle } from "@/models/model";
import { activeItemAtom, currentProjectAtom, idToDeleteCommentAtom, showCommandsAtom, showShortcutsAtom, inViewObjectAtom, showMentionListAtom, showAIChatInterfaceAtom, openAiChatByDefaultAtom, aiChatAutoOpenSuppressedAtom, aiChatExplicitOpenAtAtom, aiChatPinnedAtom, showCreateTaskModalAtom, appShellRailAtom, tasksPlayListAtom, taskDetailNonEssentialReadyAtom, archiveShortcutNudgeAtom } from "@/store";
import axios from "axios";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useRecoilState, useRecoilValue, useSetRecoilState } from "@/lib/state";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useGetPriorityForTask } from "@/hooks/MultiPages/useGetPriorityForTask";
import { useGetEstimateForTask } from "@/hooks/MultiPages/useGetEstimateForTask";
import { setTaskLabelsQueryData, useGetAllTaskLabels } from "@/hooks/MultiPages/useGetAllTaskLabels";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useUndoContext } from "@/hooks/General/useUndo";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import globalAPIHandlers from "@/utils/api/global";
import useArchiveAndNavigate from "@/hooks/Task Detail/useArchiveAndNavigate";
import { useTaskTime } from "@/hooks/Task Detail/useTimeTracking";
import useSetStickyHeight from "@/hooks/Task Detail/useSetStickyHeight";
import { useFollowersContext } from "@/lib/contexts/TaskDetail/FollowersProvider";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import useHypertasksRecoilStates from "@/hooks/RecoilRoot/useHypertasksRecoilStates";
import useUpdateSubtask from "@/hooks/Task Detail/useUpdateSubtask";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import useCopyURL from "@/hooks/General/useCopyURL";
import { usePreventFigmaReload } from "@/hooks/Task Detail/usePreventEmbedReload";
import { useGetTaskShareLinks } from "@/hooks/Task Detail/useGetShareLinks";
import { ViewVisibility } from "@prisma/client";
import { useTaskRelations } from "@/hooks/Task Detail/useTaskRelations";
import { useGetSectionsMoveTask } from "@/hooks/MultiPages/useGetSectionsMoveTask";
import globalConstants from "@/lib/constants";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { hasFigmaEmbed } from "@/utils/helperFunctions/hasFigmaEmbed";
import { wrapBlockQuote } from "@/utils/helperFunctions/TaskDetail";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { LIKESHORTCUTEVENT } from "@/lib/constants/constants";
import { LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, type LearnTutorialDismissibleSurface } from "@/lib/tutorial/learnTutorialState";
import { emitProductPerformanceEvent } from "@/lib/analytics/productPerformance";
import { performanceDeviceClass } from "@/lib/analytics/appPerformanceScope";
import { createTaskDetailInitialScrollGuard } from "@/lib/taskDetailInitialScroll";
import { consumeTaskDetailReadinessSample, TASK_DETAIL_READINESS_MAX_MS, taskDetailUsableDomPresent } from "@/lib/analytics/taskDetailReadiness";
import { markTaskDetailPhase, readTaskDetailPhaseTimings, TASK_DETAIL_COMP_MOUNT_MARK, TASK_DETAIL_SUSPENSE_COMMIT_MARK, TASK_DETAIL_USABLE_MARK } from "@/lib/analytics/taskDetailPhaseTimings";
interface TaskDetailProps {
    isMobile: boolean;
    _slugs: string[];
    _currentTask: string;
    _comments: string;
    allowPerks: boolean;
    _currentUser: IUser;
    embedded?: boolean;
}
// Now you can use this interface in your TaskDetail component
const TaskDetail: React.FC<TaskDetailProps> = ({ _slugs, _currentTask, _comments, _currentUser, embedded = false, }) => {
    // ================== DATA FROM SERVER
    const _parsedTask = JSON.parse(_currentTask);
    const _parsedComments = JSON.parse(_comments);
    const currentUser = _currentUser;
    // HTPR-6047: mark the first render of the component the shared Suspense
    // boundary is gating - this is as close as a render-phase mark can get to
    // "the boundary committed" without a fake second data point. Guarded by a
    // ref (not state) so it fires exactly once and never triggers a re-render.
    const suspenseCommitMarkedRef = useRef(false);
    if (!suspenseCommitMarkedRef.current) {
        suspenseCommitMarkedRef.current = true;
        markTaskDetailPhase(TASK_DETAIL_SUSPENSE_COMMIT_MARK);
    }
    // Effects run after commit, so this timestamp is always at or after the
    // suspense-commit mark above - the gap between them is React's own commit
    // and effect-scheduling cost, not app code.
    useEffect(() => {
        markTaskDetailPhase(TASK_DETAIL_COMP_MOUNT_MARK);
    }, []);
    const queryClient = useQueryClient();
    const { undoData, undoAction } = useUndoContext();
    const [currentProject, setCurrentProject] = useRecoilState(currentProjectAtom);
    const [nonEssentialReady, setNonEssentialReady] = useRecoilState(taskDetailNonEssentialReadyAtom);
    const setArchiveNudge = useSetRecoilState(archiveShortcutNudgeAtom);
    const { currentId, setCurrentTask, currentTask, editMode, setEditMode, requestDescriptionFocus, setEditState, focusOn, editModeCheck, onGoback, setIsSummaryExpand, isSummaryExpanded, refocusAndOpenTaskWriter, scrollSetting, showSubtaskLinkingModal, toggleSubtaskLinkingModal, showCommentDeleteModal, setShowCommentDeleteModal, showTaskDeleteModal, setShowTaskDeleteModal, setShowTaskOptionsModal, showRemoveSubtaskModal, setShowRemoveSubtaskModal, handlePinComment, handleStarTask, createContextOptionsForHTC, setShowRemindMeModal, editCommentHandler, replyToCommentHandler, toggleEmojiPicker, isRecording, scrollVirtualize, comments, setComments, carousalItems, setCarousalItems, defaultCommentFocus, showRemindMeModal, toggleHistory, newCommentIds, newCommentsSnapshotReady, virtualizer, visibleCommentIndices, virtualizeIndexes, scrollElementRef, } = useTaskContext();
    const { markAsDone, navigateToNextTask, navigateToPreviousTask } = useArchiveAndNavigate();
    const { callBackHandlerRemoveParent } = useUpdateSubtask();
    const { dynamicTopValue, dynamicElementRef, setStickyElementHeight } = useSetStickyHeight();
    const { followers, prefix: followerKeyPrefix, PostFollower, } = useFollowersContext();
    const { onWindowFocus } = usePreventFigmaReload();
    const { navigate } = useHypertasksNavigate();
    const searchParams = useSearchParams();
    // =================== REF OBJECTS
    const lastGPress = useRef<number | null>(null);
    const hasScrolledToUnreadRef = useRef(false);
    const readinessTaskRef = useRef("");
    // One-shot guard for the no-unread bottom scroll, kept separate from the unread
    // "landed" ref so a later refetch that surfaces unread can still jump to it.
    const hasBottomScrolledRef = useRef(false);
    // Cancel handle for the in-flight bottom-settling scroll. Held in a ref (not
    // returned from the deciding effect) so a dependency change mid-settle doesn't
    // kill the ~2.5s loop and land short; task changes or user input cancel it.
    const bottomScrollCancelRef = useRef<null | (() => void)>(null);
    const initialScrollGuard = useMemo(() => createTaskDetailInitialScrollGuard(() => {
        bottomScrollCancelRef.current?.();
        bottomScrollCancelRef.current = null;
    }), []);
    const initialScrollGenerationRef = useRef(0);
    // const assignInputRef = useRef<HTMLInputElement>(null);
    const lastM_APress = useRef<number | null>(null);
    const [movingItem, setMovingItem] = useState(false);
    // ======================= constants
    // get current task keys
    const currentItemInTasksPlaylist = {
        projectId: parseInt(_parsedTask.projectId),
        uniqueIndex: _parsedTask.uniqueIndex,
    };
    const { updateTaskInCache, moveItem, removeFromListWithStatus, getProjectIdxAndAllData, } = UpdateKanban();
    const { copyTaskURL, copyTaskFormattedURL, copySharedTaskFormattedURL, copySharedTaskURL, copyTitleAndTicketNumber, copyTicketNumber, } = useCopyURL();
    const { removeRelation } = useTaskRelations();
    const router = useRouter();
    // =================== React Query Hooks
    // Comments are already fetched once by DescriptionAndCommentsProvider's
    // useCommentAndDescriptions (same query key, [CommentsTQPrefixKey, taskId]).
    // A second useGetAllComments call here used to fire its own request on
    // every task-detail open (HTPR-6047); the refetch below reaches that same
    // query instance instead of holding a redundant observer.
    // Only prefetches the Move-task dropdown, which can't open before ready
    // anyway; moveToColumn.tsx fetches its own copy (same query key) the moment
    // it's actually opened, so deferring this prefetch drops nothing (HTPR-6047).
    const { data: sectionsForProjectTQ = [] } = useGetSectionsMoveTask([taskDetailConfig.queryKeys.moveTaskModal, currentProject?.id], currentProject?.id!, undefined, nonEssentialReady);
    const { data: priorityForTaskTQ } = useGetPriorityForTask([taskDetailConfig.queryKeys.priority, _parsedTask.id], _parsedTask.id, _parsedTask?.priority);
    const { data: estimateForTaskTQ } = useGetEstimateForTask([taskDetailConfig.queryKeys.estimate, _parsedTask.id], _parsedTask.id, _parsedTask?.estimate);
    // ShareTaskButton (inside the primary-actions readiness marker) only opens
    // the share modal on click; it doesn't need the link pre-created. The write
    // that creates it can wait until ready (HTPR-6047).
    const { data: sharedLink } = useGetTaskShareLinks(_parsedTask.id, _parsedTask.projectId, currentUser?.id!, undefined, nonEssentialReady);
    const { data: labelsFromTQ, isRefetching } = useGetAllTaskLabels(_parsedTask.id, []);
    const taskTimer = useTaskTime(_parsedTask.id);
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
    const [showMoveTaskToBoard, setShowMoveTaskToBoard] = useState<boolean>(false);
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
            const surface = (event as CustomEvent<{
                surface?: LearnTutorialDismissibleSurface;
            }>).detail?.surface;
            if (surface === "assignees")
                setShowAssignModal(false);
            if (surface === "priority")
                setShowPriorityModal(false);
        };
        window.addEventListener(LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, dismissTutorialTaskModal);
        return () => window.removeEventListener(LEARN_TUTORIAL_DISMISS_TASK_MODAL_EVENT, dismissTutorialTaskModal);
    }, []);
    // To check operating system
    const isApple = useDeviceContext();
    // =================== RECOIL ROOT STATE OBJECTS
    const { resetShowCommands, toggleCreateTaskGlobally } = useHypertasksRecoilStates();
    const [showShortucts, setShowShortcuts] = useRecoilState(showShortcutsAtom);
    const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
    const setTasksPlayList = useSetRecoilState(tasksPlayListAtom);
    const commandContextOptions = useMemo(() => showCommands.show ? { ...createContextOptionsForHTC() } : undefined, [showCommands]);
    const [idToDelete, setIdToDelete] = useRecoilState<any>(idToDeleteCommentAtom);
    const [activeItem, _setActiveItem] = useRecoilState(activeItemAtom);
    const [inViewObject, setInViewObject] = useRecoilState(inViewObjectAtom);
    const [showAiChatInterface, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
    const openAiChatByDefault = useRecoilValue(openAiChatByDefaultAtom);
    const aiChatAutoOpenSuppressed = useRecoilValue(aiChatAutoOpenSuppressedAtom);
    const aiChatPinned = useRecoilValue(aiChatPinnedAtom);
    const [, setAiChatAutoOpenSuppressed] = useRecoilState(aiChatAutoOpenSuppressedAtom);
    const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
    const [showMentionList, setShowMentionList] = useRecoilState(showMentionListAtom);
    const showCreateTaskModal = useRecoilValue(showCreateTaskModalAtom);
    const { callBackHandlerSubtaskLinking, callBackHandlerRemoveSubtask } = useUpdateSubtask();
    const { goToProjectShortcut, updateCommentsActivityQuery } = useProjectQuery();
    const { startNewSession, editor: aiChatEditor } = useAiChatContext();
    const { copyCommentToAiChat, summarizeComment, summarizeTicket } = useCommentToAiChat();
    const _mbl = useContext(MobileViewContext);
    const initialScrollViewportRef = useRef({
        taskId: _parsedTask.id,
        isMobile: _mbl,
    });
    const appShellRailOn = useRecoilValue(appShellRailAtom) && !_mbl && !embedded;
    // Pinning always opens chat. Otherwise, the default setting opens it unless
    // a manual close suppressed auto-open or the task is shown on mobile.
    useEffect(() => {
        if (_mbl ||
            (!aiChatPinned && (!openAiChatByDefault || aiChatAutoOpenSuppressed)))
            return;
        setShowAiChatInterface(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        _parsedTask?.id,
        openAiChatByDefault,
        aiChatAutoOpenSuppressed,
        aiChatPinned,
        _mbl,
    ]);
    // const dummy = useRef<HTMLElement | null>(null);
    const controller: {
        [key: number]: {
            pressed: boolean;
        };
    } = {
        ...globalConstants.multipleKeys,
    };
    // =================================== SHORCUT KEYS HANDLERS ====================================
    const handleKeyUp = (event: KeyboardEvent) => {
        if (controller[event.keyCode]) {
            controller[event.keyCode].pressed = false;
        }
    };
    // honestly this can be improved very easily, but at the moment, if its not broken dont fix it :)
    // TODO: create an object containing all keyboard buttons used here as keys, and their handler functions as values.
    // get all ESCAPE and ENTER functions under one hood.
    // RETURN from the functions, might as well do them now fuck it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleKeyDown = (e: KeyboardEvent) => dispatchTaskDetailCommand(e, () => ({ CTRL_ENTERHandler, EnterHandler, PostFollower, UnFollowCallback, _parsedTask, aHandler, activeModals, audioInputHandler, carousalItems, copySharedTaskFormattedURL, copySharedTaskURL, copyTaskFormattedURL, copyTaskURL, copyTicketNumber, copyTitleAndTicketNumber, currentTask, currentUser, defaultCommentFocus, editMode, editModeCheck, focusOn, gPressHandler, goToProjectShortcut, handleStarTask, idToDelete, isApple, isRecording, isSummaryExpanded, lastGPress, lastM_APress, linksModalToggle, markAsDone, moveTaskToNextColumn, navigate, navigateToNextTask, navigateToPreviousTask, requestDescriptionFocus, resetShowCommands, returnCurrentFocusedType, scrollVirtualize, searchParams, sectionsForProjectTQ, setArchiveNudge, setCarousalItems, setEditMode, setIsSummaryExpand, setShowCommands, setShowCommentDeleteModal, setShowCreateLabelModal, setShowDropdown, setShowShortcuts, sharedLink, showAssignModal, showCommands, showCommentDeleteModal, showCreateLabelModal, showEmojiPickerAtComment, showMoveModal, showPriorityModal, showShortucts, taskTimer, tipTapClassName, titleEscapeHandler, toggleCreateTaskGlobally, toggleDeleteModal, toggleDueDate, toggleEstimateModal, toggleHistory, toggleLabelModal, toggleMoveModal, toggleMoveToBoardModal, togglePriorityModal, toggleSubtaskLinkingModal, undoData, undoHandler, updateActiveItemAndItemInView }));
    //  ===================================================================================================
    //  ============================================= HELPER FUNCTIONS ====================================
    //  ===================================================================================================
    const taskUpdateCommentsInCache = (newComment: IComment) => {
        updateCommentsActivityQuery(comments, newComment, currentTask!.id, (comments: IComment[]) => setComments(comments));
    };
    async function moveTaskToNextColumn(sectionToMoveTo: ISection) {
        try {
            const sectionsInModal: ISection[] = sectionsForProjectTQ;
            if (sectionsInModal.length === 0 || !currentTask || movingItem)
                return;
            const currentTaskSectionId = currentTask.sectionId!;
            setCurrentTask((prev) => prev
                ? {
                    ...prev,
                    sectionId: sectionToMoveTo.id,
                    section: sectionToMoveTo.section_title,
                }
                : prev);
            setMovingItem(true);
            const response = await fetch(taskDetailConfig.apiEndpoints.moveTask, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    projectId: currentTask.projectId,
                    taskId: currentTask.id,
                    section_title: sectionToMoveTo.section_title,
                    sectionId: sectionToMoveTo.id,
                    section: sectionToMoveTo?.section_title,
                }),
            });
            if (response.status === taskDetailConfig.httpStatus.ok) {
                const data = await response.json();
                taskUpdateCommentsInCache(data.newComment);
                if (!sectionToMoveTo.visibility)
                    await removeFromListWithStatus(currentTaskSectionId, currentTask.projectId, currentTask.id, taskDetailConfig.taskStatus.move);
                // router.refresh()
                else
                    await moveItem({
                        destinationSectionId: sectionToMoveTo.id!,
                        itemId: currentTask.id,
                        sourceSectionId: currentTaskSectionId,
                    });
                const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(currentTask.projectId);
                const projectAfterMove = allData?.updatedProjects?.[projectToUpdateIndex];
                const sourceSection = projectAfterMove?.filteredSections.find((section) => section.sectionId === currentTaskSectionId ||
                    section.id === currentTaskSectionId);
                // Keep detail navigation anchored to the column being triaged after the moved task leaves it.
                if (projectAfterMove)
                    setTasksPlayList((sourceSection?.items ?? []).map((task) => ({
                        projectId: task.projectId,
                        uniqueIndex: task.uniqueIndex,
                    })));
            }
            setMovingItem(false);
        }
        catch (error) {
            console.error("🚀 ~ moveTaskToNextColumn ~ error:", error);
        }
    }
    function returnCurrentFocusedType() {
        if (currentTask?.userId?.toString === currentUser.id.toString &&
            document.activeElement?.id === descriptionContainerId)
            return "Description";
        else if (document.activeElement?.id?.indexOf("comment-") === 0)
            return "Edit-Comment";
        else if (document.activeElement?.id === "comment")
            return "New-Comment";
        else
            return "Others";
    }
    // handler for when user presses escape during title edit mode, if in "CREATE TASK" mode, then do router.back
    // apparently, this doesn't even run, the actual place it runs is in taskTitle file
    const titleEscapeHandler = () => {
        console.log("🚀 ~ titleEscapeHandler ~ currentTask:", currentTask);
        if (currentTask?.id === -1)
            return navigate("Back");
        setEditMode(null);
        focusOn("title");
    };
    const gPressHandler = (e: any, shift: boolean) => {
        const now = new Date().getTime();
        const lastGPressedBw500ms = lastGPress.current &&
            now - lastGPress.current < taskDetailConfig.delays.doubleKeyPress;
        if (lastGPressedBw500ms) {
            lastGPress.current = null;
            if (shift) {
                defaultCommentFocus();
            }
            else {
                focusOn(descriptionContainerId, false);
                scrollVirtualize("description");
            }
            e.preventDefault();
        }
        else {
            // setLastGPress(now);
            lastGPress.current = now;
            setTimeout(() => {
                if (lastGPress.current === now)
                    lastGPress.current = null;
            }, globalConstants.gThenKeyDelay);
            editModeCheck;
            return;
        }
    };
    // --------------- keypress handler for [Enter]
    const EnterHandler = (e: any) => {
        // ==-------------------== Mark As Done
        if (document.activeElement?.id === taskDetailConfig.elementIds.markAsDone)
            markAsDone();
        if (document.activeElement?.id === taskDetailConfig.elementIds.copyTaskUrlButton)
            copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
    };
    // --------------- keypress handler for [CTRL]+[Enter]
    const CTRL_ENTERHandler = (e: any) => {
        // edit title
        if (document.activeElement?.id === taskDetailConfig.elementIds.title) {
            // console.log("enter pressesss one",document.activeElement?.id)
            setTimeout(() => {
                setEditMode(taskDetailConfig.editModes.title);
            }, taskDetailConfig.delays.titleEditMode);
        }
    };
    // undoHandler function
    const undoHandler = async (data: any, toastId: string) => {
        // console.log('🚀 ~ undoHandler ~ data:', data);
        // first, you need to bring the item back to its place.
        // then, you need to run the API call so there is no render blocking.
        await undoAction("UNDO_INBOX_ARCHIVE", data);
        queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.inbox] });
        navigate("Refresh");
        toast(taskDetailConfig.toastMessages.undoNotificationArchive);
        toast.dismiss(toastId); // Dismiss the toast here
        navigateToPreviousTask(false, true); // false, true means undo wasn't CLICKED, but pressed
    };
    // ============ toggle estimate modal
    const toggleLabelModal = (taskLabels?: ITaskLabel[], refresh?: boolean, shouldCloseOnUpdate = true) => {
        console.log("current label modal value: ", showCreateLabelModal);
        // Same stale-pointer guard as togglePriorityModal (HTPR-3731).
        if (!showCreateLabelModal && currentTask)
            updateActiveItemAndItemInView(currentTask.id);
        if (shouldCloseOnUpdate)
            setShowCreateLabelModal((prev) => !prev);
        if (refresh && taskLabels) {
            setTaskLabelsQueryData(queryClient, _parsedTask.id, taskLabels);
            const taskToReturn = { taskLabels: taskLabels };
            updateTaskInCache(taskToReturn, _parsedTask.id, _parsedTask.projectId, _parsedTask.sectionId, currentProject);
            queryClient.refetchQueries({
                queryKey: [globalConstants.CommentsTQPrefixKey, _parsedTask.id],
            });
            // updateLabels(taskLabels,sectionId, _activeItem??id)
        }
    };
    // [a] handler
    const aHandler = () => {
        const now = new Date().getTime();
        if (lastM_APress.current && now - lastM_APress.current < 500) {
            lastM_APress.current = null;
            return;
        }
        lastM_APress.current = now;
        currentTask && updateActiveItemAndItemInView(currentTask.id);
        toggleModal();
    };
    // --------------------=================== END KEYPRESS HELPERS ----------------=====================================
    const toggleMoveToBoardModal = () => setShowMoveTaskToBoard((prev) => !prev);
    // ---------------------- return focus to comment
    const returnFocusToComment = () => {
        const extractedId = currentId.replace("-input", ""); // Remove the "-input" part
        focusOn(extractedId);
    };
    // =============================== CALLBACK HANDLER FROM COMMANDS
    const callback = (payload: any, mode: string) => {
        if (mode === taskDetailConfig.commandModes.delete)
            deleteComment(payload);
        else if (mode === taskDetailConfig.commandModes.archive)
            return markAsDone();
        else if (mode === taskDetailConfig.commandModes.acceptTask)
            return moveTaskToNextColumn(payload);
        else if (mode === taskDetailConfig.commandModes.dueDate)
            // @ts-ignore
            setCurrentTask((old) => ({ ...old, dueDate: payload }));
        else if (mode === taskDetailConfig.commandModes.assignees)
            // @ts-ignore
            setCurrentTask((old) => ({ ...old, assignees: payload }));
        else if (mode === "WaitingOn")
            setCurrentTask((old) => (old ? { ...old, ...payload } : old));
        else if (mode === taskDetailConfig.commandModes.openAiWriter)
            openAifromHtc();
        else if (mode === taskDetailConfig.commandModes.viewSubTasks)
            viewSubTasksfromHtc();
        else if (mode === taskDetailConfig.commandModes.copyCommentLinkUrl)
            copyCommentURLFromHTC();
        else if (mode === taskDetailConfig.commandModes.copyCommentContent)
            copyCommentContentFromHTC();
        else if (mode === taskDetailConfig.commandModes.createTaskFromComment)
            createTaskFromCommentHTC();
        else if (mode === taskDetailConfig.commandModes.editComment)
            handleEditCommentFromHTC();
        else if (mode === taskDetailConfig.commandModes.branchInNewChat)
            branchInNewChat();
        else if (mode === taskDetailConfig.commandModes.copyCommentToAiChat)
            copyFocusedCommentToAiChat();
        else if (mode === taskDetailConfig.commandModes.summarizeComment)
            summarizeFocusedComment();
        else if (mode === taskDetailConfig.commandModes.summarizeTicket)
            void summarizeTicket();
        else if (mode === taskDetailConfig.commandModes.fastLikeComment)
            fastLikeFocusedComment();
        else if (mode === taskDetailConfig.commandModes.replyToComment)
            handleReplyCommentFromHTC();
        else if (mode === taskDetailConfig.commandModes.reactToComment)
            handleReactToCommentFromHTC();
        else if (mode === taskDetailConfig.commandModes.addSubtask)
            callBackHandlerSubtaskLinking(payload);
        else if (mode === taskDetailConfig.commandModes.moveTaskToInbox)
            moveTaskToInbox(currentUser.id, currentTask?.projectId!, currentTask?.id!);
        else if (mode === taskDetailConfig.commandModes.starTask)
            handleStarTask();
        else if (mode === taskDetailConfig.commandModes.starComment)
            handleStarCommentFromHTC(payload);
        else if (mode === taskDetailConfig.commandModes.copyFunctions)
            handleCopyFunctionsFromHTC(payload);
        else if (mode === taskDetailConfig.commandModes.archiveTaskNotification)
            navigateToNextTask(true, true);
        else if (mode === taskDetailConfig.commandModes.setReminder)
            setShowRemindMeModal((prev) => !prev);
        else if (mode === taskDetailConfig.commandModes.removeParent)
            callBackHandlerRemoveParent();
        else if (mode === taskDetailConfig.commandModes.removeSubtask)
            toggleRemoveSubtaskModal();
        else if (mode === taskDetailConfig.commandModes.addRelation)
            setCurrentTask((previous) => previous
                ? {
                    ...previous,
                    relatedFromTasks: [
                        ...(previous.relatedFromTasks ?? []),
                        ...(payload as TaskRelations[]),
                    ],
                }
                : previous);
        else if (mode === taskDetailConfig.commandModes.followTask)
            PostFollower(Number(currentUser?.id), Number(currentTask?.id));
        //Wont touch how this is called. Just shifting the place where its called.
        else if (mode === taskDetailConfig.commandModes.unfollowTask)
            UnFollowCallback();
        else if (mode === taskDetailConfig.commandModes.speechToText)
            audioInputHandler();
        else if (mode === taskDetailConfig.commandModes.toggleTimeTracking)
            toggleTimeTracking();
        else if (mode === "DescriptionRestored")
            void getTask();
    };
    const toggleTimeTracking = async () => {
        if (!currentTask?.id)
            return;
        try {
            const summary = await axios.get(`/api/time/task?taskId=${currentTask.id}`);
            await axios.post(summary.data.runningEntry ? "/api/time/stop" : "/api/time/start", { taskId: currentTask.id });
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["time", "task", currentTask.id] }),
                queryClient.invalidateQueries({ queryKey: ["time", "running"] }),
            ]);
        }
        catch (error: any) {
            toast.error(error?.response?.data?.error ?? "Unable to update timer");
        }
    };
    const branchInNewChat = () => {
        setAiChatAutoOpenSuppressed(false);
        if (!showAiChatInterface) {
            setAiChatExplicitOpenAt(new Date().getTime());
            setShowAiChatInterface(true);
        }
        startNewSession();
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        const comment = comments[commentIndex];
        if (!comment)
            return;
        const wrapblockquote = wrapBlockQuote(comment.text, comment.creator!, true);
        aiChatEditor?.commands.setContent(wrapblockquote);
        aiChatEditor?.commands.focus();
    };
    const copyFocusedCommentToAiChat = () => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        copyCommentToAiChat(comments[commentIndex]);
    };
    const summarizeFocusedComment = () => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        void summarizeComment(comments[commentIndex]);
    };
    const fastLikeFocusedComment = () => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return; // == null, not !commentIndex: index 0 is a valid comment
        const comment = comments[commentIndex];
        if (!comment || comment.activity)
            return;
        window.dispatchEvent(new CustomEvent(LIKESHORTCUTEVENT, {
            detail: { currentId: `comment-${commentIndex}` },
        }));
    };
    const audioInputHandler = (improve: boolean = false) => {
        //get current focused ID. Alright. If we have current focused then
        //opoen audio on that alright.
        const shouldImprove = improve ? taskDetailConfig.audioButtons.improveSuffix : "";
        if (currentId === taskDetailConfig.elementIds.comment) {
            setEditMode(taskDetailConfig.editModes.comment);
            focusOn(taskDetailConfig.elementIds.commentInput, false);
            document.getElementById(taskDetailConfig.elementIds.bottom)?.scrollIntoView({
                behavior: "instant" as ScrollBehavior,
                block: "start",
            });
            document
                .getElementById(taskDetailConfig.audioButtons.createComment + "-" + taskDetailConfig.audioButtons.suffix + shouldImprove)
                ?.click();
        }
        else if (currentId === descriptionContainerId) {
            focusOn(taskDetailConfig.editModes.description);
            document
                .getElementById(taskDetailConfig.audioButtons.popoverWrapperPrefix + taskDetailConfig.editModes.description)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            setEditMode(taskDetailConfig.editModes.description);
            focusOn(descriptionContainerId);
            setTimeout(() => document
                .getElementById(taskDetailConfig.audioButtons.readEditDescription + "-" + taskDetailConfig.audioButtons.suffix + shouldImprove)
                ?.click(), taskDetailConfig.delays.audioButtonClick);
        }
        return;
    };
    const moveTaskModalCallback = (section: ISection) => {
        setCurrentTask((prev) => prev
            ? {
                ...prev,
                sectionId: section.id,
                section: section.section_title,
            }
            : prev);
    };
    const moveTaskToInbox = async (userId: number, projectId: number, taskId: number) => {
        const response = await axios.post(taskDetailConfig.apiEndpoints.moveTaskToInbox, {
            userId,
            projectId,
            taskId,
        });
        if (response.status === taskDetailConfig.httpStatus.ok) {
            await toast.success(taskDetailConfig.toastMessages.taskMovedToInbox);
            navigateToNextTask(true, true, true, taskDetailConfig.positions.forceNavigate);
        }
    };
    //Handles copy functions from HTC
    const handleCopyFunctionsFromHTC = (payload: "Private" | "PrivateFormatted" | "Public" | "PublicFormatted" | "TitleAndID" | "ID") => {
        switch (payload) {
            case taskDetailConfig.copyTypes.id:
                copyTicketNumber(currentTask?.ticketNumber ?? "");
                return;
            case taskDetailConfig.copyTypes.titleAndId:
                copyTitleAndTicketNumber(currentTask?.title!, currentTask?.ticketNumber!);
                return;
            case taskDetailConfig.copyTypes.private:
                copyTaskURL(currentTask?.uniqueIndex, currentTask?.projectId);
                return;
            case taskDetailConfig.copyTypes.privateFormatted:
                copyTaskFormattedURL(currentTask?.title!, currentTask?.ticketNumber!, currentTask?.uniqueIndex, currentTask?.projectId);
                return;
            case taskDetailConfig.copyTypes.public:
                copySharedTaskURL(sharedLink.id);
                return;
            case taskDetailConfig.copyTypes.publicFormatted:
                copySharedTaskFormattedURL(sharedLink.id, currentTask?.title!, currentTask?.ticketNumber!);
                return;
            default:
                break;
        }
    };
    const getCurrentCommentIndex = (createTask = false) => {
        if (!currentId.startsWith("comment-"))
            return;
        if (currentId === taskDetailConfig.elementIds.commentInput)
            return;
        const commentIndex = parseInt(currentId.split("-")[1]);
        if (comments[commentIndex]?.activity)
            return;
        if (createTask && !comments[commentIndex].creatorId)
            return;
        return commentIndex;
    };
    const handleReactToCommentFromHTC = useCallback(() => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        toggleEmojiPicker(commentIndex);
    }, [currentId, comments]);
    const handleReplyCommentFromHTC = useCallback(() => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        replyToCommentHandler(commentIndex);
    }, [currentId, comments]);
    const handleEditCommentFromHTC = useCallback(() => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        editCommentHandler(commentIndex);
    }, [currentId, comments]);
    const handleStarCommentFromHTC = useCallback((type: ViewVisibility) => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        console.log("🚀 ~ handleStarCommentFromHTC ~ commentIndex:", comments[commentIndex]);
        handlePinComment(comments[commentIndex]?.id, type);
    }, [currentId, comments]);
    //callback for creating task from comment from htc
    const createTaskFromCommentHTC = useCallback(() => {
        const commentIndex = getCurrentCommentIndex(true);
        if (commentIndex == null)
            return;
        const linkhtml = taskDetailConfig.urls.templates.commentLink(currentTask?.projectId!, String(currentTask?.uniqueIndex!), currentTask?.ticketNumber!, commentIndex);
        const mentionhtml = taskDetailConfig.urls.templates.mention(comments[commentIndex].creator?.displayName!, comments[commentIndex].creator?.id!);
        const heading = `${mentionhtml} said in ${linkhtml}`;
        toggleCreateTaskGlobally({
            sectionId: currentTask?.sectionId!,
            sectionTitle: currentTask?.section!,
            position: taskDetailConfig.positions.top,
            prefilledDescription: `<p>${heading}<blockquote>${comments[commentIndex].text}</blockquote></p>`,
            prefilledAttachments: processAttachmentsForNewTask(comments[commentIndex].attachments),
            createTaskFromComment: {
                task: currentTask!,
                commentIndex,
            },
        });
    }, [currentId, comments]);
    //for processing comment attachments if any when creating new task from comment
    const processAttachmentsForNewTask = (attachments?: IAttachment[]) => {
        if (!attachments || attachments.length === 0)
            return [];
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
    //callback for copying comment url from htc
    const copyCommentURLFromHTC = () => {
        const currentURL = `${process.env.NEXT_PUBLIC_BASEURL}${taskDetailConfig.urls.taskDetailPattern}${currentTask?.projectId}/${currentTask?.uniqueIndex}`;
        navigator.clipboard.writeText(currentURL + `${taskDetailConfig.urls.commentHashPrefix}${currentId.replace("comment-", "")}`); // Copy it to the clipboard
        toast(taskDetailConfig.toastMessages.commentLinkCopied);
    };
    /**
     * Function for copying comment text. Similar to how text is copied when clicking Ctrl+C on a comment after selection.
     * Check useGetSelectionDetails.tsx on how this works.
     * Just copying comment.Text was not working as expected due to formatting issues and tiptap pasterules.
     * @return {*}
     */
    const copyCommentContentFromHTC = async () => {
        const commentIndex = getCurrentCommentIndex();
        if (commentIndex == null)
            return;
        const comment = comments[commentIndex];
        if (!comment)
            return;
        // Ordinary comments use their database ID. Figma comments keep their
        // Tiptap editor mounted with an index-based ID across read and edit modes.
        // Select the expected ID directly so a database ID cannot collide with a
        // different comment's array index.
        const commentElement = hasFigmaEmbed(comment.text)
            ? document.getElementById(`comment-${commentIndex}-input`)
            : document.getElementById(`comment-${comment.id}-input`);
        if (!commentElement)
            return;
        // Create a range that covers all text content in the comment
        const range = document.createRange();
        range.selectNodeContents(commentElement);
        // Get the current selection and clear it
        const selection = window.getSelection();
        if (!selection)
            return;
        selection.removeAllRanges();
        selection.addRange(range);
        // Get both HTML and plain text formats (like native Ctrl+C)
        const serializer = new XMLSerializer();
        const selectedNode = range.cloneContents();
        const selectedHtml = serializer.serializeToString(selectedNode);
        const selectedText = selection.toString();
        // Clear the selection to avoid visual highlighting
        selection.removeAllRanges();
        // Copy to clipboard with both HTML and plain text formats to preserve formatting
        if (selectedText) {
            try {
                if (navigator.clipboard &&
                    typeof navigator.clipboard.write === "function") {
                    const clipboardItem = new ClipboardItem({
                        "text/html": new Blob([selectedHtml], { type: "text/html" }),
                        "text/plain": new Blob([selectedText], { type: "text/plain" }),
                    });
                    await navigator.clipboard.write([clipboardItem]);
                    toast(taskDetailConfig.toastMessages.commentContentCopied);
                }
                else {
                    // Fallback for browsers without full Clipboard API support
                    await navigator.clipboard.writeText(selectedText);
                    toast(taskDetailConfig.toastMessages.commentContentCopied);
                }
            }
            catch (error) {
                console.error("Failed to copy comment content:", error);
                toast.error(taskDetailConfig.toastMessages.errorCopyCommentContent);
            }
        }
    };
    //callback for opening links modal from htc
    const viewSubTasksfromHtc = () => {
        return linksModalToggle();
    };
    //callback for opening ai writer from htc
    const openAifromHtc = useCallback(() => {
        refocusAndOpenTaskWriter(currentId);
    }, [currentId]);
    // =============================== DELETE COMMENT HANDLER
    const deleteComment = async (id: number) => {
        // reset the focus to one up or one lower.
        let currentIndex = parseInt(currentId.split("-")[1]);
        // remove the comment from view.
        // setComments((comments) =>
        // comments?.filter((comment) => String(comment.id) !== String(id))
        // );
        queryClient.refetchQueries({
            queryKey: [globalConstants.CommentsTQPrefixKey, _parsedTask.id],
        });
        if (currentIndex >= 0) {
            if (comments.length === 1) {
                defaultCommentFocus();
            }
            else if (currentIndex === comments.length - 1) {
                scrollVirtualize("comment", currentIndex - 1);
            }
            else if (currentIndex < comments.length - 1)
                setTimeout(() => {
                    scrollVirtualize("comment", currentIndex);
                }, 1);
            // markAsUnarchive(_selectedTask, index)
        }
    };
    // ======================== update active item and inViewObejct
    const updateActiveItemAndItemInView = (taskId: number | null) => {
        _setActiveItem(taskId);
        setInViewObject({
            taskId: taskId,
            taskProjectId: currentTask?.projectId ?? null,
            sectionId: currentTask?.sectionId ?? null,
            taskTicketNumber: currentTask?.ticketNumber ?? null,
            sectionTitle: currentTask?.section ?? null,
            taskTitle: currentTask?.title ?? null,
        });
    };
    //  ===================================================================================================
    //  ============================================= MODAL CLOSE HANDLERS ================================
    //  ===================================================================================================
    // ----------------------- Assign User Close modal -----------------
    const toggleModal = (_assignees?: IAssignees[], keepOpen?: boolean) => {
        // Same stale-pointer guard as togglePriorityModal: the assign menu's
        // refetch keys come from inViewObject (HTPR-3731).
        if (!showAssignModal && !_assignees && currentTask)
            updateActiveItemAndItemInView(currentTask.id);
        // Only update when we actually got the fresh assignee rows. reactstrap's
        // <Modal toggle={onClose}> passes the close *event* as the first arg on a
        // backdrop/Escape dismiss; a bare `if (_assignees)` treated that event as
        // the array and overwrote assignees with a SyntheticEvent, blanking the
        // panel until reload (HTPR-3731). Mirrors the Array.isArray guard the
        // Ctrl+K handler already uses in commands.tsx.
        if (Array.isArray(_assignees)) {
            if (!currentTask)
                return;
            // Update the open task's own panel first: it must never depend on the
            // board-cache bookkeeping below succeeding (HTPR-3731).
            setCurrentTask((prev) => {
                if (!prev)
                    return prev;
                else
                    return { ...prev, assignees: _assignees };
            });
            const taskToReturn = { assignees: _assignees };
            try {
                updateTaskInCache(taskToReturn, currentTask.id, currentTask.projectId, currentTask.sectionId, currentProject);
            }
            catch (error) {
                console.error("🚀 ~ toggleModal ~ updateTaskInCache:", error);
            }
        }
        // keepOpen lets the assign menu refresh the task without closing, so
        // multiple people can be toggled in one session.
        if (!keepOpen)
            setShowAssignModal((prev) => !prev);
    };
    // ------------------------ # delete modal toggler
    const toggleDeleteModal = () => setShowTaskDeleteModal((prev) => !prev);
    // ----------------------- Links Modal Close modal -----------------
    const linksModalToggle = (_assignees?: IUser[]) => {
        setShowLinksModal((prev) => !prev);
    };
    const toggleMoveModal = () => {
        // if(currentProject?.sorting_mode==="Priority"){
        //   return toast("Cannot move tasks while kanban is in Priority mode")
        // }
        // Same stale-pointer guard as togglePriorityModal (HTPR-3731): MoveToColumn
        // moves inViewObject.taskId, which goes stale after arrow/inbox navigation
        // and then moves the WRONG task (HTPR-4543). Re-point it at the open task.
        if (!showMoveModal && currentTask)
            updateActiveItemAndItemInView(currentTask.id);
        navigate("Refresh");
        setShowMoveModal((prev) => !prev);
    };
    //  ===================================================================================================
    //  ============================================= API HANDLER FUNCTIONS ===============================
    //  ===================================================================================================
    // ----------------------- [PRESS P] || [CLICK ON Priority] (set Priority)
    const togglePriorityModal = (refresh?: boolean) => {
        // Label clicks reach here without the keyboard handler's pointer update,
        // and the modal writes/refetches via inViewObject/activeItem. Re-point
        // them at the open task before showing, so the pick can't hit a stale
        // task after board hovers or in-detail navigation (HTPR-3731).
        if (!showPriorityModal && currentTask)
            updateActiveItemAndItemInView(currentTask.id);
        setShowPriorityModal((prev) => !prev);
        if (refresh)
            queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.priority, activeItem] });
    };
    const toggleRemindMeModal = async (refresh?: boolean) => {
        setShowRemindMeModal((prev) => !prev);
        if (refresh) {
            // No router.refresh() here: navigateToNextTask queues router.replace to
            // the next task and a refresh's completing transition restores the old
            // URL, cancelling the advance (same bug as Ctrl+E, HTPR-4234). A snooze
            // always leaves the task page (HTPR-4595): next task when the playlist
            // has one, otherwise back to where the user came from.
            const inboxFlow = searchParams?.get("inboxFlow");
            navigateToNextTask(true, true, true, "forceNavigate", inboxFlow);
        }
    };
    // ----------------------- [PRESS S] || [CLICK ON Priority] (set Priority)
    const toggleEstimateModal = (refresh?: boolean) => {
        // Same stale-pointer guard as togglePriorityModal (HTPR-3731).
        if (!showEstimateModal && currentTask)
            updateActiveItemAndItemInView(currentTask.id);
        setShowEstimateModal((prev) => !prev);
        if (refresh)
            queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.estimate, activeItem] });
    };
    const setDueDateCallback = (date: Date | undefined) => {
        if (!currentTask)
            return;
        // setDueDateApiHandler(date, currentTask?.id!)
        // @ts-ignore
        setCurrentTask((old) => ({ ...old, dueDate: date }));
    };
    const toggleDueDate = (refresh?: boolean) => setShowDueDateModal((prev) => !prev);
    const toggleRemoveSubtaskModal = () => setShowRemoveSubtaskModal((prev) => !prev);
    // ----------------------- [PRESS #] (delete task)
    const deleteTask = async (state: boolean) => {
        if (!currentTask || !state)
            return;
        try {
            const response = await globalAPIHandlers.deleteTaskAPI(currentTask.id);
            console.log("🚀 ~ deleteTask ~ response:", response);
            // @ts-ignore
            setCurrentTask((old) => ({ ...old, status: taskDetailConfig.taskStatus.deleted }));
            await queryClient.refetchQueries({ queryKey: [taskDetailConfig.queryKeys.projectsAll] });
            toast(taskDetailConfig.toastMessages.taskDeleted);
            onGoback();
        }
        catch (error: any) {
            console.log("🚀 ~ deleteTask ~ error:", error);
            toast.error(taskDetailConfig.toastMessages.errorDeletingTask);
        }
        finally {
            toggleDeleteModal();
        }
    };
    // ---------------------- GET TASK
    const getTask = async () => {
        navigate(taskDetailConfig.navigation.refresh);
        if (_parsedTask && _parsedTask.id !== taskDetailConfig.taskIds.newTask) {
            setCurrentProject(_parsedTask.project);
            // setCurrentTask(task)
            // setComments(task.comments)
            // setValue(`${_parsedTask?.title}`);
        }
    };
    const UnFollowCallback = () => {
        const matchedObject = followers.find((item) => item.userId === currentUser?.id);
        UnFollow(matchedObject?.id);
    };
    const UnFollow = async (id: any) => {
        if (id) {
            try {
                await axios
                    .post(taskDetailConfig.apiEndpoints.unfollowTask, {
                    id: id,
                })
                    .then((response) => {
                    if (response.status === taskDetailConfig.httpStatus.ok) {
                        // getFollowerById();
                        queryClient.refetchQueries({
                            queryKey: [followerKeyPrefix, currentTask?.id],
                        });
                    }
                });
            }
            catch (error) {
                console.log(error);
            }
        }
    };
    const removeRelationHandler = async (relationId: number) => {
        const response = await removeRelation(relationId);
        if (response) {
            // @ts-ignore
            setCurrentTask((prev) => {
                return {
                    ...prev,
                    relatedFromTasks: prev?.relatedFromTasks?.filter((item) => item.id !== relationId),
                    relatedToTasks: prev?.relatedToTasks?.filter((item) => item.id !== relationId),
                };
            });
        }
    };
    // --------------- update priorirty
    useEffect(() => {
        setPriority_(priorityForTaskTQ);
        console.log("🚀 ~ TaskDetail ~ priorityForTaskTQ:", priorityForTaskTQ);
    }, [priorityForTaskTQ]);
    // --------------- update estimate
    useEffect(() => {
        setEstimate_(estimateForTaskTQ);
        console.log("🚀 ~ TaskDetail ~ estimateForTaskTQ:", estimateForTaskTQ);
    }, [estimateForTaskTQ]);
    // Keep the @mention project scope in sync with the ticket being viewed.
    // MENTION_PROJECT_ID is a single global localStorage key that the create-task
    // modal overwrites while open and REMOVES on close (TiptapCreateTaskModal.tsx).
    // The detail page only set it on mount, so after closing that modal the key was
    // gone and the mention search returned no members until a full reload remounted
    // this component. Re-assert the ticket's project whenever the modal is closed
    // (skip while it is open so we don't clobber the modal's own mention scope).
    useEffect(() => {
        if (!showCreateTaskModal.show && _parsedTask?.projectId != null) {
            localStorage.setItem(taskDetailConfig.localStorage.mentionProjectId, _parsedTask.projectId);
        }
    }, [_parsedTask?.projectId, showCreateTaskModal.show]);
    // Reliably land at the very bottom of the thread on mobile.
    //
    // "Scroll to bottom" used to run defaultCommentFocus() -> scrollIntoView on
    // the #comment composer. On mobile that composer is position:fixed, so
    // scrollIntoView is a no-op (a fixed element is always "in view") and the
    // window never moved — the page stayed pinned to the top. Instead we scroll
    // the window itself to the bottom, and re-assert across a few frames: the
    // window virtualizer estimates each mobile row at 500px, so the document
    // height keeps shifting as the real rows measure in and a single scroll lands
    // short. We stop once the measured height settles (or hit a hard time cap).
    // behavior:"auto" means it just opens at the bottom with no visible scroll.
    const scrollWindowToBottomMobile = useCallback(() => {
        let cancelled = false;
        let lastHeight = -1;
        let stableFrames = 0;
        const startedAt = performance.now();
        const generation = initialScrollGenerationRef.current;
        const scrollTarget = scrollElementRef?.current;
        const cleanup = () => {
            cancelled = true;
        };
        const step = () => {
            if (cancelled || !initialScrollGuard.allows(generation))
                return cleanup();
            const height = scrollTarget?.scrollHeight ?? document.documentElement.scrollHeight;
            (scrollTarget ?? window).scrollTo({ top: height, behavior: "auto" });
            if (height === lastHeight)
                stableFrames += 1;
            else {
                stableFrames = 0;
                lastHeight = height;
            }
            // Re-assert to the current bottom until the height settles (every row has
            // measured) or we run out the clock. Growing OR shrinking heights both
            // just move the target, and each frame re-targets the true bottom.
            if (stableFrames < 3 && performance.now() - startedAt < 2500) {
                requestAnimationFrame(step);
            }
            else {
                cleanup();
            }
        };
        requestAnimationFrame(step);
        return cleanup;
    }, [initialScrollGuard, scrollElementRef]);
    // A scroll gesture owns initial positioning for one task.
    useLayoutEffect(() => {
        const generation = initialScrollGuard.reset();
        initialScrollGenerationRef.current = generation;
        hasScrolledToUnreadRef.current = false;
        hasBottomScrolledRef.current = false;
        return () => {
            initialScrollGuard.invalidate(generation);
        };
    }, [_parsedTask.id, initialScrollGuard]);
    // Rebind input listeners without restarting initial positioning.
    useLayoutEffect(() => {
        const previousViewport = initialScrollViewportRef.current;
        if (previousViewport.taskId === _parsedTask.id &&
            previousViewport.isMobile !== _mbl) {
            initialScrollGuard.invalidate(initialScrollGenerationRef.current);
        }
        initialScrollViewportRef.current = {
            taskId: _parsedTask.id,
            isMobile: _mbl,
        };
        return initialScrollGuard.listen(scrollElementRef?.current ?? window);
    }, [_mbl, _parsedTask.id, initialScrollGuard, scrollElementRef]);
    //Initial Scroll and focus when page loads
    useEffect(() => {
        const generation = initialScrollGenerationRef.current;
        const runInitialPositioning = (callback: () => void) => initialScrollGuard.run(generation, callback);
        const hash = window.location.hash.substring(1);
        window.history.scrollRestoration = "manual";
        const commentIdFromParams = searchParams?.get(taskDetailConfig.searchParams.commentId);
        if (hash || commentIdFromParams) {
            const scrollToElement = () => {
                const commentIndex = parseInt((commentIdFromParams ?? hash).split("-")[1]);
                scrollVirtualize(taskDetailConfig.elementIds.comment, commentIndex, undefined, true);
            };
            const timeout = setTimeout(() => runInitialPositioning(scrollToElement), taskDetailConfig.delays.scrollToElement);
            return () => clearTimeout(timeout);
        }
        else {
            if (searchParams?.get(taskDetailConfig.searchParams.reply)) {
                const timeout = setTimeout(() => runInitialPositioning(() => focusOn(taskDetailConfig.elementIds.commentInput)), taskDetailConfig.delays.focusCommentInput);
                return () => clearTimeout(timeout);
            }
            else if (searchParams?.get(taskDetailConfig.searchParams.audio)) {
                const timeout = setTimeout(() => runInitialPositioning(() => focusOn(taskDetailConfig.elementIds.commentInput)), taskDetailConfig.delays.focusCommentInput);
                document.getElementById(`${taskDetailConfig.audioButtons.createComment}-${taskDetailConfig.audioButtons.suffix}`)?.click();
                return () => clearTimeout(timeout);
            }
            else if (searchParams?.get(taskDetailConfig.searchParams.inboxFlow)) {
                // Coming from the inbox: "Bottom" and "Inbox" both scroll to the bottom;
                // "None" leaves focus on the description.
                if (scrollSetting === taskDetailConfig.scrollSettings.none) {
                    runInitialPositioning(() => focusOn(descriptionContainerId));
                }
                else if (_mbl) {
                    // Select the composer, but DEFER the actual scroll to the snapshot-ready
                    // effect below: it lands on the first unread comment (read new-onwards),
                    // or the bottom when nothing is new. Scrolling here too would fight it.
                    runInitialPositioning(() => focusOn(taskDetailConfig.elementIds.comment, false, undefined, undefined, true));
                    return;
                }
                else {
                    const timeout = setTimeout(() => runInitialPositioning(defaultCommentFocus), taskDetailConfig.delays.defaultCommentFocus);
                    return () => clearTimeout(timeout);
                }
            }
            else {
                if (_mbl) {
                    // Select the composer; the snapshot-ready effect below owns the mobile
                    // scroll (first unread, else bottom) so it can decide from unread state.
                    const timeout = setTimeout(() => runInitialPositioning(() => focusOn(taskDetailConfig.elementIds.comment, false, undefined, undefined, true)), taskDetailConfig.delays.mobileFocusComment);
                    return () => clearTimeout(timeout);
                }
                else {
                    if (scrollSetting !== taskDetailConfig.scrollSettings.bottom) {
                        runInitialPositioning(() => focusOn(descriptionContainerId));
                    }
                    else {
                        const timeout = setTimeout(() => runInitialPositioning(defaultCommentFocus), taskDetailConfig.delays.defaultCommentFocus);
                        return () => clearTimeout(timeout);
                    }
                }
            }
        }
    }, [_parsedTask.id]);
    // Where a freshly-opened task lands. Runs once the unread snapshot is ready so
    // it knows whether anything is new; the mount effect defers its mobile scroll
    // to here so the two don't fight. Preference: land on the FIRST UNREAD comment
    // (read new-onwards); if nothing is new, fall to the very bottom so the last
    // comment sits fully above the composer. Explicit deep-links win over both.
    useEffect(() => {
        const generation = initialScrollGenerationRef.current;
        const runInitialPositioning = (callback: () => void) => initialScrollGuard.run(generation, callback);
        if (hasScrolledToUnreadRef.current ||
            !newCommentsSnapshotReady ||
            !initialScrollGuard.allows(generation))
            return;
        const hash = window.location.hash.substring(1);
        const hasDeepLink = hash ||
            searchParams?.get(taskDetailConfig.searchParams.commentId) ||
            searchParams?.get(taskDetailConfig.searchParams.reply) ||
            searchParams?.get(taskDetailConfig.searchParams.audio);
        // Desktop keeps its prior behavior: a "bottom" preference is handled by the
        // mount effect (defaultCommentFocus), so skip here. On mobile the unread jump
        // wins, and we own the bottom fall-through, so we do NOT skip for bottom.
        const fromInbox = !!searchParams?.get(taskDetailConfig.searchParams.inboxFlow);
        const shouldScrollToBottom = fromInbox
            ? scrollSetting !== taskDetailConfig.scrollSettings.none
            : scrollSetting === taskDetailConfig.scrollSettings.bottom;
        if (hasDeepLink || (!_mbl && shouldScrollToBottom))
            return;
        const firstNewCommentIndex = newCommentIds.length
            ? comments.findIndex((comment) => Number(comment.id) === newCommentIds[0])
            : -1;
        const visiblePosition = firstNewCommentIndex === -1
            ? -1
            : visibleCommentIndices.indexOf(firstNewCommentIndex);
        if (visiblePosition === -1) {
            // No locatable unread. If there are genuinely none, settle at the bottom
            // (mobile) ONCE — but don't mark "landed", so a later refetch that surfaces
            // unread can still jump to it. If unread exist but aren't locatable yet,
            // just wait for a re-run (comments/indices still filling in).
            if (!newCommentIds.length &&
                _mbl &&
                shouldScrollToBottom &&
                !hasBottomScrolledRef.current) {
                hasBottomScrolledRef.current = true;
                bottomScrollCancelRef.current = scrollWindowToBottomMobile();
            }
            return;
        }
        // Unread located: stop any bottom settle, then land on the first new comment
        // so the user reads new-onwards. Set the "landed" ref inside the timeout (not
        // before) so a dependency change during the delay reschedules instead of
        // dropping the jump.
        bottomScrollCancelRef.current?.();
        bottomScrollCancelRef.current = null;
        const timeout = setTimeout(() => {
            runInitialPositioning(() => {
                hasScrolledToUnreadRef.current = true;
                focusOn(`comment-${firstNewCommentIndex}`, false);
                virtualizer.scrollToIndex(virtualizeIndexes.commentsStartVirtualIndex + visiblePosition, { align: "start", behavior: "auto" });
                requestAnimationFrame(() => {
                    runInitialPositioning(() => {
                        (scrollElementRef?.current ?? window).scrollBy({
                            top: -Math.round(window.innerHeight / 3),
                            behavior: "auto",
                        });
                    });
                });
            });
        }, taskDetailConfig.delays.scrollToElement);
        return () => clearTimeout(timeout);
    }, [
        _parsedTask.id,
        comments,
        focusOn,
        initialScrollGuard,
        newCommentIds,
        newCommentsSnapshotReady,
        scrollSetting,
        scrollElementRef,
        scrollWindowToBottomMobile,
        searchParams,
        virtualizer,
        virtualizeIndexes.commentsStartVirtualIndex,
        visibleCommentIndices,
    ]);
    useEffect(() => {
        if (embedded)
            return;
        // Add event listeners when the component mounts
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        // Remove event listeners when the component unmounts
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
        };
    }, [
        handleKeyDown,
        handleKeyUp,
        sharedLink,
        isRecording,
        showMentionList,
        currentTask,
        carousalItems,
        embedded,
    ]);
    useEffect(() => {
        getTask();
    }, [_currentTask]);
    useEffect(() => {
        const readinessTask = `${_parsedTask.projectId}:${_parsedTask.id}`;
        // Embedded views (swipe-unread) don't run this readiness tracking at all,
        // so non-essential requests there have nothing to wait on - let them fire
        // immediately rather than never.
        if (embedded) {
            setNonEssentialReady(true);
            return;
        }
        if (readinessTaskRef.current === readinessTask)
            return;
        setNonEssentialReady(false);
        let frame = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let observer: MutationObserver | undefined;
        let poll: ReturnType<typeof setInterval> | undefined;
        // The 30s timer below still publishes the real readiness event (a task
        // that never reaches the DOM markers - share view, no description editor,
        // permission-limited, an error state - is a genuine measurement failure
        // worth keeping). But the non-essential gate has no reason to make AI
        // suggestions, the share link and the move-task sections wait that long:
        // fail it open after 3s regardless (HTPR-6047).
        const nonEssentialFallback = setTimeout(() => setNonEssentialReady(true), 3000);
        const cleanup = () => {
            if (frame)
                cancelAnimationFrame(frame);
            if (timer)
                clearTimeout(timer);
            if (poll)
                clearInterval(poll);
            clearTimeout(nonEssentialFallback);
            observer?.disconnect();
        };
        const publish = (timedOut = false) => {
            if (readinessTaskRef.current === readinessTask)
                return;
            const measured = consumeTaskDetailReadinessSample();
            const sample = timedOut
                ? {
                    ...measured,
                    measurementEligible: false as const,
                    exclusionReason: "usable_state_timeout" as const,
                }
                : measured;
            readinessTaskRef.current = readinessTask;
            if (!timedOut)
                markTaskDetailPhase(TASK_DETAIL_USABLE_MARK);
            // HTPR-6047: phase attribution for the gap. Read after the usable mark
            // above so phase_usable_ms can see it - a timed-out publish never sets
            // that mark, so phase_usable_ms stays null on that path, matching
            // exclusion_reason rather than reporting a fake completion time.
            const phaseTimings = readTaskDetailPhaseTimings();
            emitProductPerformanceEvent({
                event: "app_task_detail_readiness",
                properties: {
                    analytics_surface: "authenticated_app",
                    app_hostname: window.location.hostname,
                    route_family: "task_detail",
                    route_path: "/detail",
                    entry_path: sample.entryPath,
                    navigation_mode: sample.navigationMode,
                    navigation_type: sample.navigationType,
                    duration_ms: sample.durationMs,
                    device_class: performanceDeviceClass(),
                    project_id: Number(_parsedTask.projectId),
                    task_id: Number(_parsedTask.id),
                    measurement_eligible: sample.measurementEligible,
                    exclusion_reason: sample.exclusionReason,
                    readiness_measurement_version: 1,
                    readiness_measurement_scope: "task_detail_open_to_usable",
                    ...phaseTimings,
                },
            }, currentUser.id!);
            setNonEssentialReady(true);
            cleanup();
        };
        const checkReady = () => {
            frame = 0;
            if (taskDetailUsableDomPresent(document))
                publish();
        };
        const scheduleCheck = () => {
            if (!frame)
                frame = requestAnimationFrame(checkReady);
        };
        observer = new MutationObserver(scheduleCheck);
        observer.observe(document.documentElement, { childList: true, subtree: true });
        timer = setTimeout(() => publish(true), TASK_DETAIL_READINESS_MAX_MS);
        // HTPR-6047: the rAF+MutationObserver path alone can silently lose a
        // scheduled check across a tab freeze/resume (backgrounding, sleep/wake,
        // OS-level suspension) - reproduced via CDP Page.setWebLifecycleState.
        // A plain interval keeps firing across that gap, so it catches
        // usability even when the primary path drops its pending check.
        poll = setInterval(checkReady, 250);
        scheduleCheck();
        return cleanup;
    }, [currentUser.id, embedded, _parsedTask.id, _parsedTask.projectId, setNonEssentialReady]);
    useLayoutEffect(() => {
        updateActiveItemAndItemInView(currentTask?.id ?? null);
        setStickyElementHeight();
    }, []); // Empty dependency array, so it runs once on mount
    // Opening/closing the AI chat sidebar resizes the main content and reflows the
    // title, changing its height. The ResizeObserver can miss the settled height
    // across that layout swap, leaving the sticky header overlapping the task body
    // until a reload. Recompute after the toggle's layout settles (rAF).
    useEffect(() => {
        const raf = requestAnimationFrame(() => setStickyElementHeight());
        return () => cancelAnimationFrame(raf);
    }, [showAiChatInterface]);
    useEffect(() => {
        console.log("🚀 ~ parsed task priority:", _parsedTask.priority);
        console.log("🚀 ~ parsed task estimate:", _parsedTask.estimate);
    }, []);
    focusManager.setEventListener(onWindowFocus);
    if (!currentTask)
        return <></>;
    const updateWaitingOn = (fields: {
        waitingOnUserId: number | null;
        waitingOnSetById: number | null;
        waitingOnSetAt: string | null;
    }) => setCurrentTask((task) => (task ? { ...task, ...fields } : task));
    const updateCycle = (cycle: ICycle | null) => setCurrentTask((task) => task ? { ...task, cycle, cycleId: cycle?.id ?? null } : task);
    return renderTaskDetailPanels({ callback, _currentTask, _mbl, _parsedTask, _slugs, appShellRailOn, callBackHandlerRemoveSubtask, callBackHandlerSubtaskLinking, carousalItems, commandContextOptions, comments, currentId, currentItemInTasksPlaylist, currentTask, currentUser, deleteTask, dynamicElementRef, dynamicTopValue, embedded, estimate_, followers, idToDelete, labelsFromTQ, linksModalToggle, moveTaskModalCallback, moveTaskToNextColumn, navigateToNextTask, navigateToPreviousTask, onGoback, priority_, removeRelationHandler, scrollElementRef, searchParams, sectionsForProjectTQ, setCarousalItems, setComments, setDueDateCallback, setShowCommands, setShowCommentDeleteModal, setShowCreateLabelModal, setShowMoveTaskToBoard, showAssignModal, showCommands, showCommentDeleteModal, showCreateLabelModal, showDueDateModal, showEstimateModal, showLinksModal, showMoveModal, showMoveTaskToBoard, showPriorityModal, showRemindMeModal, showRemoveSubtaskModal, showShortucts, showSubtaskLinkingModal, showTaskDeleteModal, taskUpdateCommentsInCache, toggleDueDate, toggleEstimateModal, toggleLabelModal, toggleModal, toggleMoveModal, toggleMoveToBoardModal, togglePriorityModal, toggleRemindMeModal, toggleRemoveSubtaskModal, toggleSubtaskLinkingModal, updateCycle, updateWaitingOn });
};
export default TaskDetail;
