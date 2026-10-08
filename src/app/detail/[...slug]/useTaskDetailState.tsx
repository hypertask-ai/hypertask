import { IUser } from "@/models/model";
import { currentProjectAtom, taskDetailNonEssentialReadyAtom, archiveShortcutNudgeAtom } from "@/store";

import { useEffect, useMemo, useRef, useState } from "react";

import { useRecoilState, useSetRecoilState } from "@/lib/state";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { useGetPriorityForTask } from "@/hooks/MultiPages/useGetPriorityForTask";
import { useGetEstimateForTask } from "@/hooks/MultiPages/useGetEstimateForTask";
import { useGetAllTaskLabels } from "@/hooks/MultiPages/useGetAllTaskLabels";
import { useUndoContext } from "@/hooks/General/useUndo";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import useArchiveAndNavigate from "@/hooks/Task Detail/useArchiveAndNavigate";
import { useTaskTime } from "@/hooks/Task Detail/useTimeTracking";
import useSetStickyHeight from "@/hooks/Task Detail/useSetStickyHeight";
import { useFollowersContext } from "@/lib/contexts/TaskDetail/FollowersProvider";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import useUpdateSubtask from "@/hooks/Task Detail/useUpdateSubtask";
import useCopyURL from "@/hooks/General/useCopyURL";
import { usePreventFigmaReload } from "@/hooks/Task Detail/usePreventEmbedReload";
import { useGetTaskShareLinks } from "@/hooks/Task Detail/useGetShareLinks";
import { useTaskRelations } from "@/hooks/Task Detail/useTaskRelations";
import { useGetSectionsMoveTask } from "@/hooks/MultiPages/useGetSectionsMoveTask";
import { createTaskDetailInitialScrollGuard } from "@/lib/taskDetailInitialScroll";
import { markTaskDetailPhase, TASK_DETAIL_COMP_MOUNT_MARK, TASK_DETAIL_SUSPENSE_COMMIT_MARK } from "@/lib/analytics/taskDetailPhaseTimings";
import { useAuth } from "@/hooks/General/useAuth";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6972_SUBTASK_LINK_FLAG, HTPR_6991_BACK_FIRST_OPEN_FLAG, HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG } from "@/lib/flags/keys";
import { taskDetailReadKey } from "@/lib/taskDetailReads";
import { cachedTaskDetailKey } from "@/lib/navigation/cachedTaskDetail";

export interface TaskDetailProps {
  isMobile: boolean;
  _slugs: string[];
  allowPerks: boolean;
  _currentUser: IUser;
  embedded?: boolean;
}
export function useTaskDetailState({
  _slugs,
  _currentUser,
  embedded = false,
}: TaskDetailProps) {

  // ================== DATA FROM SERVER
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
  const [currentProject, setCurrentProject] =
    useRecoilState(currentProjectAtom);
  const [nonEssentialReady, setNonEssentialReady] = useRecoilState(
    taskDetailNonEssentialReadyAtom
  );
  const setArchiveNudge = useSetRecoilState(archiveShortcutNudgeAtom);

  const {
    parsedTask: _currentTask,
    cachedLayout,
    currentId,
    setCurrentTask,
    currentTask,
    editMode,
    setEditMode,
    requestDescriptionFocus,
    setEditState,
    focusOn,
    editModeCheck,
    onGoback,
    setIsSummaryExpand,
    isSummaryExpanded,
    refocusAndOpenTaskWriter,
    scrollSetting,
    showSubtaskLinkingModal,
    toggleSubtaskLinkingModal,
    showCommentDeleteModal,
    setShowCommentDeleteModal,
    showTaskDeleteModal,
    setShowTaskDeleteModal,
    setShowTaskOptionsModal,
    showRemoveSubtaskModal,
    setShowRemoveSubtaskModal,
    handlePinComment,
    handleStarTask,
    createContextOptionsForHTC,
    setShowRemindMeModal,
    editCommentHandler,
    replyToCommentHandler,
    toggleEmojiPicker,
    isRecording,
    scrollVirtualize,
    comments,
    setComments,
    carousalItems,
    setCarousalItems,
    defaultCommentFocus,
    showRemindMeModal,
    toggleHistory,
    newCommentIds,
    newCommentsSnapshotReady,
    virtualizer,
    visibleCommentIndices,
    virtualizeIndexes,
    scrollElementRef,
  } = useTaskContext();
  const _parsedTask = useMemo(() => JSON.parse(_currentTask), [_currentTask]);
  const dedupe = useFlag(HTPR_7009_DEDUPE_TASK_DETAIL_READS_FLAG);
  const subtaskLink = useFlag(HTPR_6972_SUBTASK_LINK_FLAG);
  const backFirstOpen = useFlag(HTPR_6991_BACK_FIRST_OPEN_FLAG);
  const { authenticatedUserId } = useAuth();
  useEffect(() => {
    if ((!subtaskLink && !backFirstOpen) || embedded || authenticatedUserId !== currentUser?.id || !(_parsedTask.id > 0)) return;
    // An authorized Next route must remain available to native Back/Forward,
    // even when Next later drops its custom history marker or waits for RSC.
    const key = cachedTaskDetailKey(currentUser.id, _parsedTask.id);
    if (!queryClient.getQueryState(key)) queryClient.setQueryData(key, _parsedTask);
  }, [subtaskLink, backFirstOpen, embedded, authenticatedUserId, currentUser?.id, _parsedTask, queryClient]);
  useEffect(() => {
    if (!dedupe || cachedLayout || embedded || authenticatedUserId !== currentUser?.id || !(_parsedTask.id > 0)) return;
    const key = taskDetailReadKey(currentUser.id, _parsedTask.id);
    queryClient.setQueryData(key, _parsedTask);
  }, [dedupe, cachedLayout, embedded, authenticatedUserId, currentUser?.id, _parsedTask, queryClient]);
  const { markAsDone, navigateToNextTask, navigateToPreviousTask } =
    useArchiveAndNavigate();
  const { callBackHandlerRemoveParent } = useUpdateSubtask();
  const { dynamicTopValue, dynamicElementRef, setStickyElementHeight } = useSetStickyHeight();
  const {
    followers,
    prefix: followerKeyPrefix,
    PostFollower,
  } = useFollowersContext();
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
  const initialScrollGuard = useMemo(
    () =>
      createTaskDetailInitialScrollGuard(() => {
        bottomScrollCancelRef.current?.();
        bottomScrollCancelRef.current = null;
      }),
    []
  );
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

  const {
    updateTaskInCache,
    moveItem,
    removeFromListWithStatus,
    getProjectIdxAndAllData,
  } = UpdateKanban();
  const {
    copyTaskURL,
    copyTaskFormattedURL,
    copySharedTaskFormattedURL,
    copySharedTaskURL,
    copyTitleAndTicketNumber,
    copyTicketNumber,
  } = useCopyURL();

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
  const { data: sectionsForProjectTQ = [] } = useGetSectionsMoveTask(
    [taskDetailConfig.queryKeys.moveTaskModal, currentProject?.id],
    currentProject?.id!,
    undefined,
    nonEssentialReady
  );
  const { data: priorityForTaskTQ } = useGetPriorityForTask(
    [taskDetailConfig.queryKeys.priority, _parsedTask.id],
    _parsedTask.id,
    _parsedTask?.priority
  );
  const { data: estimateForTaskTQ } = useGetEstimateForTask(
    [taskDetailConfig.queryKeys.estimate, _parsedTask.id],
    _parsedTask.id,
    _parsedTask?.estimate
  );
  // ShareTaskButton (inside the primary-actions readiness marker) only opens
  // the share modal on click; it doesn't need the link pre-created. The write
  // that creates it can wait until ready (HTPR-6047).
  const { data: sharedLink } = useGetTaskShareLinks(
    _parsedTask.id,
    _parsedTask.projectId,
    currentUser?.id!,
    undefined,
    nonEssentialReady
  );

  const { data: labelsFromTQ, isRefetching } = useGetAllTaskLabels(
    _parsedTask.id,
    []
  );

  const taskTimer = useTaskTime(_parsedTask.id);
  return { _slugs, _currentTask, _currentUser, embedded, _parsedTask, currentUser, suspenseCommitMarkedRef, queryClient, undoData, undoAction, currentProject, setCurrentProject, nonEssentialReady, setNonEssentialReady, setArchiveNudge, currentId, setCurrentTask, currentTask, editMode, setEditMode, requestDescriptionFocus, setEditState, focusOn, editModeCheck, onGoback, setIsSummaryExpand, isSummaryExpanded, refocusAndOpenTaskWriter, scrollSetting, showSubtaskLinkingModal, toggleSubtaskLinkingModal, showCommentDeleteModal, setShowCommentDeleteModal, showTaskDeleteModal, setShowTaskDeleteModal, setShowTaskOptionsModal, showRemoveSubtaskModal, setShowRemoveSubtaskModal, handlePinComment, handleStarTask, createContextOptionsForHTC, setShowRemindMeModal, editCommentHandler, replyToCommentHandler, toggleEmojiPicker, isRecording, scrollVirtualize, comments, setComments, carousalItems, setCarousalItems, defaultCommentFocus, showRemindMeModal, toggleHistory, newCommentIds, newCommentsSnapshotReady, virtualizer, visibleCommentIndices, virtualizeIndexes, scrollElementRef, markAsDone, navigateToNextTask, navigateToPreviousTask, callBackHandlerRemoveParent, dynamicTopValue, dynamicElementRef, setStickyElementHeight, followers, followerKeyPrefix, PostFollower, onWindowFocus, navigate, searchParams, lastGPress, hasScrolledToUnreadRef, readinessTaskRef, hasBottomScrolledRef, bottomScrollCancelRef, initialScrollGuard, initialScrollGenerationRef, lastM_APress, movingItem, setMovingItem, currentItemInTasksPlaylist, updateTaskInCache, moveItem, removeFromListWithStatus, getProjectIdxAndAllData, copyTaskURL, copyTaskFormattedURL, copySharedTaskFormattedURL, copySharedTaskURL, copyTitleAndTicketNumber, copyTicketNumber, removeRelation, router, sectionsForProjectTQ, priorityForTaskTQ, estimateForTaskTQ, sharedLink, labelsFromTQ, isRefetching, taskTimer };
}

export type useTaskDetailStateValue = ReturnType<typeof useTaskDetailState>;
