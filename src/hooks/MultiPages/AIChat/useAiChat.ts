
export { type AiChatProcessedAttachment } from "./aiChatShared";

import { useState } from "react";
import { useAiChatState } from "./useAiChatState";
import { useAiChatSessions } from "./useAiChatSessions";
import { createAiChatKeyboard } from "./aiChatKeyboard";
import { useAiChatAttachments } from "./useAiChatAttachments";
import { createAiChatSend } from "./aiChatSend";
import { useAiChatPresentation } from "./useAiChatPresentation";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6936_ASK_AI_FULLSCREEN_FLAG, HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG } from "@/lib/flags/keys";

// Type-only: a value import would pull tiptap back into every page's initial
// chunk and undo the dynamic mount below (HTPR-4508).

































export function useAiChat() {
  // Failed preparation can finish without changing isTyping; wake the search handoff too.
  const [sendSettledVersion, setSendSettledVersion] = useState(0);
  const askAiFullscreenEnabled = useFlag(HTPR_6936_ASK_AI_FULLSCREEN_FLAG);
  const reloadTaskAfterChat = useFlag(HTPR_7049_RELOAD_AFTER_IMAGE_CHAT_FLAG);
  const {
  lastWorkspaceFocusRef, turnFailureState, queryClient, currentUser, currentProject,
  showAiChatInterface, setShowAIChat, setAiChatAutoOpenSuppressed, setAiChatExplicitOpenAt, aiChatExplicitOpenAt,
  aiChatBoardSessionMap, setAiChatBoardSessionMap, setRecentChatBoardIds, setAiChatPinned, isSidebarMode,
  setIsSidebarMode, showMentionList, inViewObject, dockedChatScope, setDockedChatScope,
  pathname, isDetailPage, isFullScreenChat, surface, spansAllBoards,
  chatMounted, setChatMounted, minimized, setMinimized, isTyping,
  setIsTyping, queuedMessages, setQueuedMessages, messageQueueRef, showScrollUpIndicator,
  setShowScrollUpIndicator, currentAiOption, setAiOption, modelTeamId, modelBilling,
  streamingSessionRef, streamingAssistantMessageRef, streamingRequestRef, sendInFlightRef, currentStreamingSession,
  setCurrentStreamingSession, isRecording, setIsRecording, displayAiOptions, contextList,
  setContextList, agentStatus, setAgentStatus, showRenameChatModal, setShowRenameChatModal,
  messageListRef, hasAttemptedRestoreRef, previousProjectIdRef, toggleCreateTaskGlobally, token,
  dockedProjectId, scopedProjectId, boardScopeIsExplicit, editor, editorEnabled,
  editorMountProps, taskId, shouldLoadChatHistory, createSession, activeSession,
  currentSession, showWelcomeScreen, isSessionPending, sessions, selectSessionInHistory,
  chatHistoryReady, addMessageToSessionQuery, updateLastMessageInSessionCache, appendMessageToSessionCache, updateSessionTitle,
  deleteSessionInHistory, sessionsRef, chatHistoryReadyRef, sessionSetupRef, resolvedBoardSessionRef,
  sessionIntentGenerationRef, sessionContextKey, clearMessageQueue,
  } = useAiChatState();
  const {
  selectSession, startNewSession, deleteSession, fileUpload, handleSendMessageRef,
  removeQueuedMessage, drainQueuedMessage, billing, isApple, isByokBlocked,
  isDemo, chatRoute, ensureSessionForCurrentBoard,
  } = useAiChatSessions({
    sessionIntentGenerationRef, sessionSetupRef, resolvedBoardSessionRef, clearMessageQueue, selectSessionInHistory,
    createSession, isFullScreenChat, setDockedChatScope, currentProject, previousProjectIdRef,
    deleteSessionInHistory, messageQueueRef, setQueuedMessages, sendInFlightRef, modelBilling,
    currentAiOption, pathname, currentUser, taskId, sessionsRef,
    dockedChatScope, sessionContextKey, chatHistoryReadyRef, aiChatBoardSessionMap, setAiChatBoardSessionMap,
    setRecentChatBoardIds, shouldLoadChatHistory,
  });
  const {
  handleCancelStream, audioTiptapCallback, toggleRecording, processAttachments, buildGuestBoard,
  waitForChatSession,
  } = useAiChatAttachments({
    streamingSessionRef, currentStreamingSession, streamingAssistantMessageRef, streamingRequestRef, setCurrentStreamingSession,
    setIsTyping, setAgentStatus, chatRoute, token, editor,
    setIsRecording, addMessageToSessionQuery, scopedProjectId, ensureSessionForCurrentBoard,
  });
  const {
  handleSendMessage,
  } = createAiChatSend({
    isByokBlocked, isTyping, editor, fileUpload, messageQueueRef,
    setQueuedMessages, sendInFlightRef, surface, inViewObject, waitForChatSession,
    currentProject, buildGuestBoard, processAttachments, setIsTyping, addMessageToSessionQuery,
    scopedProjectId, isFullScreenChat, taskId, dockedProjectId, setAiChatBoardSessionMap,
    modelTeamId, contextList, currentAiOption, spansAllBoards, boardScopeIsExplicit,
    pathname, currentUser, billing, isDemo, streamingSessionRef,
    streamingAssistantMessageRef, setCurrentStreamingSession, streamingRequestRef, chatRoute, token,
    turnFailureState, setAgentStatus, updateSessionTitle, queryClient, updateLastMessageInSessionCache,
    appendMessageToSessionCache, drainQueuedMessage, handleSendMessageRef, reloadTaskAfterChat,
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
    sessions,
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
