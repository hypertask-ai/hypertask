import { sidebarChatHeaders } from "@/lib/agents/chatViewerState";
import { consumeAiChatStream } from "./aiChatStream";
import { IChatMessage, IAttachment } from "@/models/model";
import toast from "react-hot-toast";
import { mcpAuthorizationHeaders } from "@/lib/mcp/bearerAuth";
import { extractStreamRefusalMessage } from "@/lib/aiChat/streamRefusal";
import { isGuestBoardBuild } from "@/lib/demo/guestBoardBuild";
import { CHAT_TRANSPORT_RETRY_DELAYS_MS, ChatRequestRefusedError, shouldRetryChatTransport } from "@/lib/aiChat/transportRetry";
import { chatModelRequestFields } from "@/lib/aiModelOptions";
import type { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";


import type { useAiChatSessions } from "./useAiChatSessions";
import type { useAiChatState } from "./useAiChatState";
import type { useAiChatAttachments } from "./useAiChatAttachments";
import type { QueuedAiChatMessage, SessionMessageQueue } from "@/lib/aiChat/sessionMessageQueue";


type Context = Pick<ReturnType<typeof useAiChatSessions>, "isByokBlocked" | "fileUpload" | "billing" | "isDemo" | "chatRoute" | "drainQueuedMessage" | "handleSendMessageRef"> &
  Pick<ReturnType<typeof useAiChatState>, "sessionIntentGenerationRef" | "sessionPagingEnabled" | "getDisplayedSession" | "isTyping" | "editor" | "messageQueueRef" | "setQueuedMessages" | "sendInFlightRef" | "surface" | "inViewObject" | "currentProject" | "setIsTyping" | "addMessageToSessionQuery" | "scopedProjectId" | "isFullScreenChat" | "taskId" | "dockedProjectId" | "setAiChatBoardSessionMap" | "modelTeamId" | "contextList" | "currentAiOption" | "usesPlanDefault" | "agentSessionAiOption" | "spansAllBoards" | "boardScopeIsExplicit" | "ticketScopeSelected" | "pathname" | "currentUser" | "streamingSessionRef" | "streamingAssistantMessageRef" | "setCurrentStreamingSession" | "streamingRequestRef" | "token" | "setAgentStatus" | "updateSessionTitle" | "queryClient" | "updateLastMessageInSessionCache" | "appendMessageToSessionCache"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "waitForChatSession" | "buildGuestBoard" | "processAttachments"> & { reloadTaskAfterChat: boolean; connectionRetry?: boolean; persistentQueue?: SessionMessageQueue };

export function createAiChatSend(context: Context, searchHandoff?: { preserveComposer: true; onSettled: () => void }) {
  const {
  sessionIntentGenerationRef, sessionPagingEnabled, getDisplayedSession, isByokBlocked, isTyping, editor, fileUpload, messageQueueRef, persistentQueue,
  setQueuedMessages, sendInFlightRef, surface, inViewObject, waitForChatSession,
  currentProject, buildGuestBoard, processAttachments, setIsTyping, addMessageToSessionQuery,
  scopedProjectId, isFullScreenChat, taskId, dockedProjectId, setAiChatBoardSessionMap,
  modelTeamId, contextList, currentAiOption, usesPlanDefault, agentSessionAiOption, spansAllBoards, boardScopeIsExplicit, ticketScopeSelected,
  pathname, currentUser, billing, isDemo, streamingSessionRef,
  streamingAssistantMessageRef, setCurrentStreamingSession, streamingRequestRef, chatRoute, token,
  setAgentStatus, updateSessionTitle, queryClient, updateLastMessageInSessionCache,
  appendMessageToSessionCache, drainQueuedMessage, handleSendMessageRef, reloadTaskAfterChat, connectionRetry,
  } = context;


  const handleSendMessage = async (
    retryContent?: string,
    options?: { htmlForAttachments?: string; filesForAttachments?: FileItem[]; preserveComposer?: boolean; queuedMessage?: QueuedAiChatMessage; sessionId?: string; onQueueBusy?: (retryAfterMs: number) => void }
  ): Promise<boolean> => {
    const originatingSessionId = getDisplayedSession?.()?.id ?? persistentQueue?.sessionId;
    const originatingIntentGeneration = sessionIntentGenerationRef.current;
    if (isByokBlocked) return false;
    if (options?.preserveComposer && !searchHandoff?.preserveComposer) return false;
    const preserveComposer = options?.preserveComposer;
    if (preserveComposer && sendInFlightRef.current) return false;
    const consumesComposer = !preserveComposer && !options?.queuedMessage && options?.filesForAttachments === undefined;

    const queuedMessage = options?.queuedMessage;
    const queueSessionId = persistentQueue?.sessionId;
    const hasQueuedMessages = persistentQueue && queueSessionId &&
      (persistentQueue.get(queueSessionId).length > 0 || persistentQueue.hasPending(queueSessionId));
    if (sendInFlightRef.current || (retryContent === undefined && (isTyping || hasQueuedMessages))) {
      const content = (retryContent ?? editor?.getText() ?? "").trim();
      if (!content) return false;
      const files = [...(options?.filesForAttachments ?? fileUpload.fileItems)];
      const queued = {
        id: crypto.randomUUID(),
        ...(persistentQueue ? { assistantMessageId: crypto.randomUUID() } : {}),
        content,
        html: retryContent === undefined
          ? editor?.getHTML() ?? ""
          : options?.htmlForAttachments ?? "",
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
      if (consumesComposer && (!persistentQueue || (persistentQueue.sessionId === queueSessionId && editor?.getHTML() === queued.html))) {
        editor?.commands.clearContent();
        if (persistentQueue) fileUpload.setFileItems((currentFiles) => currentFiles.filter((file) => !files.includes(file)));
        else fileUpload.clearFiles();
      }
      return true;
    }

    const composerHtml = editor?.getHTML() ?? "";
    const htmlContent = retryContent ?? composerHtml;
    const editorHtmlForAttachments = retryContent
      ? options?.htmlForAttachments ?? ""
      : composerHtml;
    let content = editor?.getText() ?? htmlContent;

    if (retryContent) {
      content = retryContent;
    }

    if (!content.trim()) return false;
    sendInFlightRef.current = true;
    const files = preserveComposer ? [] : [...(options?.filesForAttachments ?? queuedMessage?.files ?? fileUpload.fileItems)];
    if (consumesComposer) {
      fileUpload.clearFiles();
      editor?.commands.clearContent();
    }
    let restoreMessage = !preserveComposer && !queuedMessage;
    let restoreFiles = files.length > 0 && !queuedMessage;
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
        restoreMessage = false;
        return true;
      }

    const sidebarHeaders = sidebarChatHeaders(session.id);
    const processedAttachments = queuedMessage?.attachments ?? (preserveComposer ? [] : await processAttachments(
      editorHtmlForAttachments,
      files
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

    restoreFiles = false;
    restoreMessage = false;

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

    const streamId = crypto.randomUUID();
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
            response: { body: response.body }, setAgentStatus, assistantMessageId, session, addMessageToSessionQuery,
            updateSessionTitle, setIsTyping, queryClient, streamTaskId, reloadTaskAfterChat,
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
          payload.stream_id = crypto.randomUUID();
          streamingRequestRef.current = payload.stream_id;
        }
      }
    } catch (error) {
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
        setAgentStatus(undefined);
        setIsTyping(false);
        streamingSessionRef.current = null;
        streamingAssistantMessageRef.current = null;
        streamingRequestRef.current = null;
        setCurrentStreamingSession(null);
        console.log("Message has been completed");
      }
    } finally {
      const activeSessionId = getDisplayedSession?.()?.id ?? persistentQueue?.sessionId;
      const canRestoreComposer = activeSessionId === originatingSessionId && sessionIntentGenerationRef.current === originatingIntentGeneration;
      if (restoreMessage) {
        if (canRestoreComposer && consumesComposer && editor?.isEmpty) {
          editor.commands.setContent(composerHtml);
        } else {
          const message = {
            id: crypto.randomUUID(),
            ...(persistentQueue ? { assistantMessageId: crypto.randomUUID() } : {}),
            content,
            html: editorHtmlForAttachments,
            files,
          };
          if (persistentQueue && originatingSessionId) {
            persistentQueue.set(originatingSessionId, [message, ...persistentQueue.get(originatingSessionId)]);
          } else if (!persistentQueue && canRestoreComposer) {
            messageQueueRef.current = [message, ...messageQueueRef.current];
            setQueuedMessages(messageQueueRef.current);
          }
          restoreFiles = false;
        }
      }
      if (restoreFiles && canRestoreComposer) {
        fileUpload.setFileItems((current) => [
          ...files,
          ...current.filter((item) => !files.includes(item)),
        ]);
      }
      sendInFlightRef.current = false;
      searchHandoff?.onSettled();
      if (!restoreMessage) {
        queueMicrotask(() => {
          drainQueuedMessage(completedSessionId);
        });
      }
    }
    return !queuedMessage || queueAccepted;
  };
  handleSendMessageRef.current = handleSendMessage;
  return {
  handleSendMessage,
  };
}

export type AiChatSendContext = Context;
