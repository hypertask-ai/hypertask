import { sidebarChatHeaders } from "@/lib/agents/chatViewerState";
import { consumeAiChatStream } from "./aiChatStream";
import { IChatMessage, IAttachment } from "@/models/model";
import toast from "react-hot-toast";
import { mcpAuthorizationHeaders } from "@/lib/mcp/bearerAuth";
import { extractStreamRefusalMessage } from "@/lib/aiChat/streamRefusal";
import { isGuestBoardBuild } from "@/lib/demo/guestBoardBuild";
import { CHAT_TRANSPORT_RETRY_DELAYS_MS, ChatRequestRefusedError, shouldRetryChatTransport } from "@/lib/aiChat/transportRetry";
import { chatModelRequestFields } from "@/lib/aiModelOptions";
import { signalAiChip } from "@/lib/ai/chipEvents";


import type { useAiChatSessions } from "./useAiChatSessions";
import type { useAiChatState } from "./useAiChatState";
import type { useAiChatAttachments } from "./useAiChatAttachments";
import type { QueuedAiChatMessage, SessionMessageQueue } from "@/lib/aiChat/sessionMessageQueue";


type Context = Pick<ReturnType<typeof useAiChatSessions>, "isByokBlocked" | "fileUpload" | "billing" | "isDemo" | "chatRoute" | "drainQueuedMessage" | "handleSendMessageRef"> &
  Pick<ReturnType<typeof useAiChatState>, "sessionPagingEnabled" | "getDisplayedSession" | "isTyping" | "editor" | "messageQueueRef" | "setQueuedMessages" | "sendInFlightRef" | "settleSendRef" | "surface" | "inViewObject" | "currentProject" | "setIsTyping" | "addMessageToSessionQuery" | "scopedProjectId" | "isFullScreenChat" | "taskId" | "dockedProjectId" | "setAiChatBoardSessionMap" | "modelTeamId" | "contextList" | "currentAiOption" | "usesPlanDefault" | "agentSessionAiOption" | "spansAllBoards" | "boardScopeIsExplicit" | "ticketScopeSelected" | "pathname" | "currentUser" | "streamingSessionRef" | "streamingAssistantMessageRef" | "setCurrentStreamingSession" | "streamingRequestRef" | "token" | "setAgentStatus" | "updateSessionTitle" | "queryClient" | "updateLastMessageInSessionCache" | "appendMessageToSessionCache"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "waitForChatSession" | "buildGuestBoard" | "processAttachments"> & { reloadTaskAfterChat: boolean; connectionRetry?: boolean; chipSendSignal?: typeof signalAiChip; persistentQueue?: SessionMessageQueue; stopClosesStream?: boolean; navigateToTask?: (projectId: number, uniqueIndex: number) => void };

export function createAiChatSend(context: Context, searchHandoff?: { preserveComposer: true; onSettled: () => void }) {
  const {
  sessionPagingEnabled, getDisplayedSession, isByokBlocked, isTyping, editor, fileUpload, messageQueueRef, persistentQueue,
  setQueuedMessages, sendInFlightRef, settleSendRef, surface, inViewObject, waitForChatSession,
  currentProject, buildGuestBoard, processAttachments, setIsTyping, addMessageToSessionQuery,
  scopedProjectId, isFullScreenChat, taskId, dockedProjectId, setAiChatBoardSessionMap,
  modelTeamId, contextList, currentAiOption, usesPlanDefault, agentSessionAiOption, spansAllBoards, boardScopeIsExplicit, ticketScopeSelected,
  pathname, currentUser, billing, isDemo, streamingSessionRef,
  streamingAssistantMessageRef, setCurrentStreamingSession, streamingRequestRef, chatRoute, token,
  setAgentStatus, updateSessionTitle, queryClient, updateLastMessageInSessionCache,
  appendMessageToSessionCache, drainQueuedMessage, handleSendMessageRef, reloadTaskAfterChat, connectionRetry, chipSendSignal, stopClosesStream, navigateToTask,
  } = context;


  const handleSendMessage = async (
    retryContent?: string,
    options?: { htmlForAttachments?: string; preserveComposer?: boolean; queuedMessage?: QueuedAiChatMessage; sessionId?: string; onQueueBusy?: (retryAfterMs: number) => void }
  ): Promise<boolean> => {
    if (isByokBlocked) return false;
    if (options?.preserveComposer && !searchHandoff?.preserveComposer) return false;
    const preserveComposer = options?.preserveComposer;

    const queuedMessage = options?.queuedMessage;
    const queueSessionId = persistentQueue?.sessionId;
    const hasQueuedMessages = persistentQueue && queueSessionId &&
      (persistentQueue.get(queueSessionId).length > 0 || persistentQueue.hasPending(queueSessionId));
    const shouldQueue = isTyping || (persistentQueue && (sendInFlightRef.current || hasQueuedMessages));
    if (retryContent === undefined && shouldQueue) {
      const content = (editor?.getText() ?? "").trim();
      if (!content) return false;
      const files = [...fileUpload.fileItems];
      const queued = {
        id: crypto.randomUUID(),
        ...(persistentQueue ? { assistantMessageId: crypto.randomUUID() } : {}),
        content,
        html: editor?.getHTML() ?? "",
        files,
      };
      if (persistentQueue) {
        if (!queueSessionId) return false;
        try {
          if (!await persistentQueue.enqueue(queueSessionId, queued, () => processAttachments(queued.html, files))) return false;
        } catch {
          toast.error("Could not save the queued message. Your draft is still in the composer.");
          return false;
        }
      } else {
        messageQueueRef.current = [...messageQueueRef.current, queued];
        setQueuedMessages(messageQueueRef.current);
      }
      if (!persistentQueue || (persistentQueue.sessionId === queueSessionId && editor?.getHTML() === queued.html)) {
        editor?.commands.clearContent();
        if (persistentQueue) fileUpload.setFileItems((currentFiles) => currentFiles.filter((file) => !files.includes(file)));
        else fileUpload.clearFiles();
      }
      return true;
    }

    if (sendInFlightRef.current) return false;

    const htmlContent = retryContent ?? editor?.getHTML() ?? "";
    const editorHtmlForAttachments = retryContent
      ? options?.htmlForAttachments ?? ""
      : editor?.getHTML() ?? "";
    let content = editor?.getText() ?? htmlContent;

    if (retryContent) {
      content = retryContent;
    }

    if (!content.trim()) return false;
    chipSendSignal?.({ kind: "send", text: content });
    let streamId = crypto.randomUUID();
    sendInFlightRef.current = true;
    if (stopClosesStream) streamingRequestRef.current = streamId;
    const ownsSend = () => !stopClosesStream || streamingRequestRef.current === streamId;
    const acceptedFiles = preserveComposer || queuedMessage ? [] : [...fileUpload.fileItems];
    let acceptedFilesDropped = false;
    const dropAcceptedFiles = () => {
      if (acceptedFilesDropped || acceptedFiles.length === 0) return;
      acceptedFilesDropped = true;
      fileUpload.setFileItems((currentFiles) => currentFiles.filter((file) => !acceptedFiles.includes(file)));
    };
    let settled = false;
    const settleSend = (completedSession?: string) => {
      if (settled) return;
      settled = true;
      if (stopClosesStream && !ownsSend()) dropAcceptedFiles();
      streamingRequestRef.current = null;
      sendInFlightRef.current = false;
      if (stopClosesStream) settleSendRef.current = null;
      searchHandoff?.onSettled();
      queueMicrotask(() => {
        drainQueuedMessage(completedSession);
      });
    };
    if (stopClosesStream) settleSendRef.current = settleSend;
    const taskAwareChatSurface =
      surface === "task_detail" || surface === "inbox";
    const streamTaskId =
      taskAwareChatSurface && inViewObject?.taskId
        ? inViewObject.taskId
        : undefined;

    let completedSessionId: string | undefined;
    let queueAccepted = false;
    try {
      if (queuedMessage && persistentQueue?.sessionId !== options?.sessionId) return false;
      const session = await waitForChatSession();
      if (!session) {
        toast.error("AI chat is still loading. Please try again.");
        if (preserveComposer) throw new Error("AI chat session is unavailable");
        return false;
      }

      if (queuedMessage && (session.id !== options?.sessionId || persistentQueue?.sessionId !== session.id)) return false;
      completedSessionId = session.id;
      if (isGuestBoardBuild(currentProject)) {
        await buildGuestBoard(content.trim(), session);
        return true;
      }

    const sidebarHeaders = sidebarChatHeaders(session.id);
    const processedAttachments = queuedMessage?.attachments ?? (preserveComposer ? [] : await processAttachments(
      editorHtmlForAttachments,
      fileUpload.fileItems
    ));

    if (sessionPagingEnabled && !isDemo && getDisplayedSession()?.id !== session.id) return false;

    const images64 = processedAttachments.filter((item) =>
      item.mimeType?.startsWith("image/")
    );
    const pdfs64 = processedAttachments.filter(
      (item) => item.mimeType === "application/pdf"
    );
    const docx64 = processedAttachments.filter(
      (item) =>
        item.mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    if (!preserveComposer && !queuedMessage) editor?.commands.clearContent();

    setIsTyping(true);

    const messageAttachments: IAttachment[] = processedAttachments.map(
      (item) => ({
        id: Date.now(),
        fileName: item.fileName,
        fileType: item.mimeType || "",
        fileSource: item.url,
        chatMessageId: session.id,
        createdAt: new Date(),
      })
    );
    const assistantMessageId = queuedMessage?.assistantMessageId ?? crypto.randomUUID();

    const userMessage: IChatMessage = {
      id: queuedMessage?.id ?? Date.now().toString(),
      content,
      role: "human",
      createdAt: new Date(),
      sessionId: session.id,
      isDelivered: true,
      attachments: messageAttachments,
    };

    const chatHistory = session.messages.map((message) => ({
      content: message.content,
      role: message.role,
    }));

    if (!queuedMessage) {
      addMessageToSessionQuery(
        session.id,
        userMessage,
        false,
        false,
        scopedProjectId
      );
    }

    if (!session.agentId && !isFullScreenChat && taskId === undefined && dockedProjectId !== undefined) {
      setAiChatBoardSessionMap((previousMap) => ({
        ...previousMap,
        [dockedProjectId]: session.id,
      }));
    }

    let chatSurface = isFullScreenChat ? "fullscreen" : "sidebar";
    if (typeof navigator !== "undefined" && /\bHypertaskApp\b/.test(navigator.userAgent)) chatSurface = "desktop";
    const payload = {
      message: content,
      aiFeature: "aiChat",
      surface: chatSurface,
      teamId: modelTeamId,
      session_id: session.id,
      assistant_message_id: assistantMessageId,
      stream_id: streamId,
      context_list: contextList,
      ...chatModelRequestFields({ currentOption: currentAiOption, agentSessionOption: agentSessionAiOption, usesPlanDefault }, session.agentId),
      default_context: {
        project_id:
          spansAllBoards && !boardScopeIsExplicit ? undefined : scopedProjectId,
        surface,
        surface_path: pathname,
        view_id: currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id,
        view_name:
          currentProject?.project_view?.user_project_views?.[0]?.appliedView?.title ??
          currentProject?.title,
        ...(streamTaskId ? { task_id: streamTaskId } : {}),
        ...(ticketScopeSelected && streamTaskId ? { scope: "ticket" } : {}),
      },
      user_context: {
        id: currentUser?.id,
        email: currentUser?.email,
        displayName: currentUser?.displayName,
      },
      chat_history: chatHistory,
      attachments: processedAttachments,
      images64,
      pdfs64,
      docx64,
      byokProviderFlags: billing?.byokProviderFlags ?? [],
      ...(isDemo
        ? {
            board_context: {
              title: currentProject?.title || currentProject?.name || "Demo board",
              columns: (currentProject?.sections ?? []).slice(0, 12).map((section) => ({
                title: section.section_title,
                tasks: section.items.slice(0, 30).map((task) => ({
                  title: task.title,
                  ...(task.ticketNumber ? { ticketNumber: task.ticketNumber } : {}),
                  ...(task.priority?.Priority_Value
                    ? { priority: task.priority.Priority_Value }
                    : {}),
                  labels: (task.taskLabels ?? [])
                    .map((taskLabel) => taskLabel.label?.value)
                    .filter((label): label is string => Boolean(label))
                    .slice(0, 8),
                })),
              })),
            },
          }
        : {}),
    };

    streamingSessionRef.current = session.id;
    streamingAssistantMessageRef.current = assistantMessageId;
    setCurrentStreamingSession(session.id);
    streamingRequestRef.current = streamId;

    let assistantPlaceholderAdded = false;
    let refusalMessage: string | null = null;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await fetch(chatRoute, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...mcpAuthorizationHeaders(token),
              ...sidebarHeaders,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok || !response.body) {
            if (!response.ok) {
              refusalMessage =
                (await extractStreamRefusalMessage(response)) ??
                "The chat server refused this reply. Wait a moment and try again.";
              if (queuedMessage && ((response.status === 409 && refusalMessage.includes("already in progress")) || response.status === 429)) {
                options?.onQueueBusy?.(response.status === 429 ? 60000 : 15000);
                return false;
              }
            }
            throw new ChatRequestRefusedError(
              "Network response was not ok or body is missing",
              response.status,
            );
          }

          if (!queueAccepted && queuedMessage) {
            addMessageToSessionQuery(session.id, userMessage, false, false, scopedProjectId);
          }
          queueAccepted = true;
          if (ownsSend()) {
            if (!preserveComposer && !queuedMessage) fileUpload.clearFiles();
          } else {
            dropAcceptedFiles();
          }

          if (!assistantPlaceholderAdded) {
            const initialAssistantMessage: IChatMessage = {
              id: assistantMessageId,
              content: "",
              role: "assistant",
              createdAt: new Date(),
              sessionId: session.id,
              isDelivered: false,
            };

            addMessageToSessionQuery(session.id, initialAssistantMessage, true);
            assistantPlaceholderAdded = true;
          }
          await consumeAiChatStream({
            isCurrentStream: ownsSend,
            response: { body: response.body }, setAgentStatus, assistantMessageId, session, addMessageToSessionQuery,
            updateSessionTitle, setIsTyping, queryClient, streamTaskId, reloadTaskAfterChat, navigateToTask,
          });
          refusalMessage = null;
          break;
        } catch (attemptError) {
          if (
            !connectionRetry ||
            streamingRequestRef.current !== payload.stream_id ||
            !shouldRetryChatTransport(attemptError, attempt)
          ) {
            throw attemptError;
          }
          refusalMessage = null;
          await new Promise((resolve) =>
            setTimeout(resolve, CHAT_TRANSPORT_RETRY_DELAYS_MS[attempt]),
          );
          if (streamingRequestRef.current !== payload.stream_id) throw attemptError;
          streamId = crypto.randomUUID();
          payload.stream_id = streamId;
          streamingRequestRef.current = streamId;
        }
      }
    } catch (error) {
      if (!ownsSend()) return false;
      setAgentStatus(undefined);
      console.error("Error generating AI response:", error);
      if (queuedMessage && !queueAccepted) return false;
      const errorMessage: IChatMessage = {
        id: isDemo
          ? assistantMessageId
          : `transport-${assistantMessageId}`,
        content: isDemo
          ? "Sorry, I'm having trouble responding right now."
          : refusalMessage ??
            "Connection lost. Reopen this chat shortly to check for the completed reply.",
        role: "assistant",
        createdAt: new Date(),
        sessionId: session.id,
        isDelivered: true,
      };
      if (assistantPlaceholderAdded) {
        updateLastMessageInSessionCache(session.id, errorMessage);
      } else {
        appendMessageToSessionCache(session.id, errorMessage);
      }
      } finally {
        if (ownsSend()) {
          setAgentStatus(undefined);
          setIsTyping(false);
          streamingSessionRef.current = null;
          streamingAssistantMessageRef.current = null;
          setCurrentStreamingSession(null);
          console.log("Message has been completed");
        }
      }
    } finally {
      if (ownsSend()) settleSend(completedSessionId);
    }
    return !queuedMessage || queueAccepted;
  };
  handleSendMessageRef.current = handleSendMessage;
  return {
  handleSendMessage,
  };
}

export type AiChatSendContext = Context;
