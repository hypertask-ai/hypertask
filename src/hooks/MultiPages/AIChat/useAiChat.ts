
export { type AiChatProcessedAttachment } from "./aiChatShared";

import { useEffect, useState } from "react";
import useHypertasksNavigate from "@/hooks/MultiPages/Route/useHypertasksNavigate";
import { useAiChatState } from "./useAiChatState";
import { useAiChatSessions } from "./useAiChatSessions";
import { createAiChatKeyboard } from "./aiChatKeyboard";
import { useAiChatAttachments } from "./useAiChatAttachments";
import { createAiChatSend } from "./aiChatSend";
import { useAiChatPresentation } from "./useAiChatPresentation";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7768_CHAT_SKILL_DRAFTS_FLAG } from "@/lib/flags/keys";
import { signalAiChip } from "@/lib/ai/chipEvents";
import { HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG, HTPR_7765_PARALLEL_CHATS_FLAG, HTPR_7756_CHAT_OPENS_TASK_FLAG, HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG, HTPR_7337_EDIT_WITH_AI_FLAG, HTPR_6936_ASK_AI_FULLSCREEN_FLAG, HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG, HTPR_7099_CHAT_CONNECTION_LOST_FLAG, HTPR_6971_CHAT_HISTORY_PAGING_FLAG, HTPR_7316_CHAT_SCOPE_TICKET_FLAG, HTPR_7794_STOP_CLOSES_STREAM_FLAG, HTPR_7978_AI_CHIP_EVENTS_FLAG } from "@/lib/flags/keys";

import { useRecoilState } from "@/lib/state";
import { aiChatEditTaskIdAtom } from "@/store";

export function useAiChat() {
  const { navigateToTask } = useHypertasksNavigate();
  const skillDraftsEnabled = useFlag(HTPR_7768_CHAT_SKILL_DRAFTS_FLAG);
  const parallelChatsEnabled = useFlag(HTPR_7765_PARALLEL_CHATS_FLAG);
  const chatOpensTask = useFlag(HTPR_7756_CHAT_OPENS_TASK_FLAG);
  const agentSidebarChatsFlag = useFlag(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG);
  let agentSidebarChatsEnabled = false;
  if (agentSidebarChatsFlag) agentSidebarChatsEnabled = true;
  const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
  const [editTaskId, setEditTaskId] = useRecoilState(aiChatEditTaskIdAtom);
  const [sendSettledVersion, setSendSettledVersion] = useState(0);
  const askAiFullscreenEnabled = useFlag(HTPR_6936_ASK_AI_FULLSCREEN_FLAG);
  const progressiveChatCreateFlag = useFlag(HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG);
  let progressiveChatCreateEnabled: true | undefined;
  if (progressiveChatCreateFlag) progressiveChatCreateEnabled = true;
  const reloadTaskAfterChat = useFlag(HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG);
  const connectionRetry = useFlag(HTPR_7099_CHAT_CONNECTION_LOST_FLAG);
  const stopClosesStream = useFlag(HTPR_7794_STOP_CLOSES_STREAM_FLAG);
  const chipEventsEnabled = useFlag(HTPR_7978_AI_CHIP_EVENTS_FLAG);
  const pagingRequested = useFlag(HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  const ticketScopeEnabled = useFlag(HTPR_7316_CHAT_SCOPE_TICKET_FLAG);
  const {
  lastWorkspaceFocusRef, queryClient, currentUser, currentProject,
  showAiChatInterface, setShowAIChat, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatExplicitOpenAt,
  aiChatBoardSessionMap, setAiChatBoardSessionMap, setRecentChatBoardIds, setAiChatPinned, isSidebarMode,
  setIsSidebarMode, showMentionList, inViewObject, dockedChatScope, setDockedChatScope,
  pathname, isDetailPage, isFullScreenChat, surface, spansAllBoards,
  chatMounted, setChatMounted, minimized, setMinimized, isTyping,
  setIsTyping, queuedMessages, persistentQueue, setQueuedMessages, messageQueueRef, showScrollUpIndicator,
  setShowScrollUpIndicator, currentAiOption, setAiOption, modelTeamId, modelBilling, usesPlanDefault, agentSessionAiOption,
  streamingSessionRef, streamingAssistantMessageRef, streamingRequestRef, sendInFlightRef, settleSendRef, currentStreamingSession,
  setCurrentStreamingSession, isRecording, setIsRecording, displayAiOptions, contextList,
  setContextList, agentStatus, setAgentStatus, showRenameChatModal, setShowRenameChatModal,
  messageListRef, hasAttemptedRestoreRef, previousProjectIdRef, toggleCreateTaskGlobally, token,
  dockedProjectId, scopedProjectId, boardScopeIsExplicit, ticketScopeSelected, editor, editorEnabled,
  editorMountProps, taskId, shouldLoadChatHistory, createSession, activeSession,
  currentSession, showWelcomeScreen, isSessionPending, sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, resolveHistorySession, getDisplayedSession, sessionPagingEnabled, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue, parallelStreams: sessionStreams,
  } = useAiChatState(parallelChatsEnabled);
  let parallelStreams = sessionStreams;
  if (!parallelChatsEnabled) parallelStreams = undefined;
  useEffect(editWithAiEnabled ? () => {
    if (editTaskId === null) return;
    if (!showAiChatInterface || taskId !== editTaskId || currentSession?.messages?.some((message) => message.role === "human")) {
      setEditTaskId(null);
    }
  } : () => {
    if (editTaskId !== null) setEditTaskId(null);
  }, [editWithAiEnabled, editTaskId, showAiChatInterface, taskId, currentSession?.messages, setEditTaskId]);

  const sessionContext = {
    parallelStreams, agentSidebarChatsEnabled, sessionIntentGenerationRef, sessionSetupRef, resolvedBoardSessionRef, clearMessageQueue, selectSessionInHistory,
    createSession, editor, isFullScreenChat, setDockedChatScope, currentProject, previousProjectIdRef,
    deleteSessionInHistory, messageQueueRef, persistentQueue, setQueuedMessages, sendInFlightRef, modelBilling,
    currentAiOption, pathname, currentUser, taskId, sessionsRef,
    dockedChatScope, sessionContextKey, chatHistoryReadyRef, aiChatBoardSessionMap, setAiChatBoardSessionMap,
    setRecentChatBoardIds, shouldLoadChatHistory, resolveHistorySession, getDisplayedSession, sessionPagingEnabled,
  };
  const {
  selectSession, startNewSession, deleteSession, fileUpload, handleSendMessageRef,
  removeQueuedMessage, drainQueuedMessage, billing, isApple, isByokBlocked,
  isDemo, chatRoute, ensureSessionForCurrentBoard,
  } = useAiChatSessions(pagingRequested ? sessionContext : { ...sessionContext, sessionPagingEnabled: false });
  const {
  handleCancelStream, audioTiptapCallback, toggleRecording, processAttachments, buildGuestBoard,
  waitForChatSession,
  } = useAiChatAttachments({
    settleSendRef, stopClosesStream: stopClosesStream || !!parallelStreams,
    streamingSessionRef, currentStreamingSession, streamingAssistantMessageRef, streamingRequestRef, setCurrentStreamingSession,
    setIsTyping, setAgentStatus, chatRoute, token, editor,
    setIsRecording, addMessageToSessionQuery, scopedProjectId, ensureSessionForCurrentBoard,
  });
  let chipSendSignal: typeof signalAiChip | undefined;
  if (chipEventsEnabled) chipSendSignal = signalAiChip;
  let sendTicketScope = false;
  if (ticketScopeEnabled) sendTicketScope = ticketScopeSelected;
  const {
  handleSendMessage,
  } = createAiChatSend({
    skillDraftsEnabled, parallelStreams, stopClosesStream, settleSendRef,
    sessionPagingEnabled: pagingRequested && sessionPagingEnabled, getDisplayedSession, resolveHistorySession, sessionsRef,
    isByokBlocked, isTyping, editor, fileUpload, messageQueueRef, persistentQueue,
    setQueuedMessages, sendInFlightRef, surface, inViewObject, waitForChatSession,
    currentProject, buildGuestBoard, processAttachments, setIsTyping, addMessageToSessionQuery,
    scopedProjectId, isFullScreenChat, taskId, dockedProjectId, setAiChatBoardSessionMap,
    ticketScopeSelected: sendTicketScope,
    modelTeamId, contextList, currentAiOption, usesPlanDefault, agentSessionAiOption, spansAllBoards, boardScopeIsExplicit,
    pathname, currentUser, billing, isDemo, streamingSessionRef,
    streamingAssistantMessageRef, setCurrentStreamingSession, streamingRequestRef, chatRoute, token,
    setAgentStatus, updateSessionTitle, queryClient, updateLastMessageInSessionCache,
    appendMessageToSessionCache, drainQueuedMessage, handleSendMessageRef, reloadTaskAfterChat, progressiveChatCreateEnabled, connectionRetry, chipSendSignal,
    navigateToTask: chatOpensTask ? navigateToTask : undefined,
  }, askAiFullscreenEnabled ? {
    preserveComposer: true,
    onSettled: () => setSendSettledVersion((version) => version + 1),
  } : undefined);
  const {
  toggleSidebarMode, togglePopover, minimizeChat, restoreChat, retryStream,
  editMessage, tiptapKeydown, layoutKeydown,
  } = createAiChatKeyboard({
    setAiChatExplicitOpenAt, setIsSidebarMode, editor, setAiChatAutoOpenSuppressed, setAiChatPinned,
    setShowAIChat, setMinimized, setChatMounted, currentSession, handleSendMessage,
    isApple, showMentionList, isByokBlocked, isTyping, handleCancelStream,
    isFullScreenChat, showAiChatInterface, isSidebarMode, lastWorkspaceFocusRef, fileUpload,
    chatMounted, startNewSession,
  });
  const {
  dropDownButtonAICallback, handleRemoveContext, handleAddContext, handleMessageListScroll, registerMessageListRef,
  scrollMessagesToBottom, copyResponse, createTaskFromResponse, toggleRenameChatModal, renameChat,
  } = useAiChatPresentation({
    setAiOption, contextList, setContextList, editor, handleCancelStream,
    streamingSessionRef, showAiChatInterface, aiChatExplicitOpenAt, setAiChatExplicitOpenAt, setChatMounted,
    hasAttemptedRestoreRef, currentUser, setShowAIChat, messageListRef, setShowScrollUpIndicator,
    toggleCreateTaskGlobally, inViewObject, setShowRenameChatModal, currentSession, updateSessionTitle,
  });

  return {
    minimized,
    minimizeChat,
    restoreChat,
    isTyping,
    sendSettledVersion,
    isRecording,
    queuedMessages,
    removeQueuedMessage,
    isByokBlocked,
    sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions, sessionPagingEnabled,
    activeSession,
    currentSession,
    showWelcomeScreen,
    isSessionPending,
    chatHistoryReady,
    isSidebarMode,
    setIsSidebarMode,
    chatMounted,
    setChatMounted,
    currentAiOption,
    modelTeamId,
    modelBilling,
    displayAiOptions,
    editor,
    editorEnabled,
    editorMountProps,
    contextList,
    showAiChatInterface,
    setShowAIChat,
    setAiChatAutoOpenSuppressed,
    isDetailPage,
    showScrollUpIndicator,
    agentStatus,
    showRenameChatModal,
    togglePopover,
    setIsTyping,
    toggleSidebarMode,
    dropDownButtonAICallback,
    tiptapKeydown,
    layoutKeydown,
    handleRemoveContext,
    handleAddContext,
    handleSendMessage,
    handleMessageListScroll,
    registerMessageListRef,
    scrollMessagesToBottom,
    copyResponse,
    editMessage,
    createTaskFromResponse,
    handleCancelStream,
    retryStream,
    audioTiptapCallback,
    toggleRecording,
    startNewSession,
    selectSession,
    toggleRenameChatModal,
    renameChat,
    deleteSession,
    ...fileUpload,
  };
}
