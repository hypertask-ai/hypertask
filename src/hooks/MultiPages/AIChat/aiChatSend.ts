import { consumeAiChatStream } from "./aiChatStream";
import { IChatMessage, IAttachment } from "@/models/model";
import toast from "react-hot-toast";
import { mcpAuthorizationHeaders } from "@/lib/mcp/bearerAuth";
import { extractStreamRefusalMessage } from "@/lib/aiChat/streamRefusal";
import { isGuestBoardBuild } from "@/lib/demo/guestBoardBuild";


import type { useAiChatSessions } from "./useAiChatSessions";
import type { useAiChatState } from "./useAiChatState";
import type { useAiChatAttachments } from "./useAiChatAttachments";


type Context = Pick<ReturnType<typeof useAiChatSessions>, "isByokBlocked" | "fileUpload" | "billing" | "isDemo" | "chatRoute" | "drainQueuedMessage" | "handleSendMessageRef"> &
  Pick<ReturnType<typeof useAiChatState>, "isTyping" | "editor" | "messageQueueRef" | "setQueuedMessages" | "sendInFlightRef" | "surface" | "inViewObject" | "currentProject" | "setIsTyping" | "addMessageToSessionQuery" | "scopedProjectId" | "isFullScreenChat" | "taskId" | "dockedProjectId" | "setAiChatBoardSessionMap" | "modelTeamId" | "contextList" | "currentAiOption" | "spansAllBoards" | "boardScopeIsExplicit" | "pathname" | "currentUser" | "streamingSessionRef" | "streamingAssistantMessageRef" | "setCurrentStreamingSession" | "streamingRequestRef" | "token" | "turnFailureState" | "setAgentStatus" | "updateSessionTitle" | "queryClient" | "updateLastMessageInSessionCache" | "appendMessageToSessionCache"> &
  Pick<ReturnType<typeof useAiChatAttachments>, "waitForChatSession" | "buildGuestBoard" | "processAttachments"> & { reloadTaskAfterChat: boolean };

export function createAiChatSend(context: Context, searchHandoff?: { preserveComposer: true; onSettled: () => void }) {
  const {
  isByokBlocked, isTyping, editor, fileUpload, messageQueueRef,
  setQueuedMessages, sendInFlightRef, surface, inViewObject, waitForChatSession,
  currentProject, buildGuestBoard, processAttachments, setIsTyping, addMessageToSessionQuery,
  scopedProjectId, isFullScreenChat, taskId, dockedProjectId, setAiChatBoardSessionMap,
  modelTeamId, contextList, currentAiOption, spansAllBoards, boardScopeIsExplicit,
  pathname, currentUser, billing, isDemo, streamingSessionRef,
  streamingAssistantMessageRef, setCurrentStreamingSession, streamingRequestRef, chatRoute, token,
  turnFailureState, setAgentStatus, updateSessionTitle, queryClient, updateLastMessageInSessionCache,
  appendMessageToSessionCache, drainQueuedMessage, handleSendMessageRef, reloadTaskAfterChat,
  } = context;


  const handleSendMessage = async (
    retryContent?: string,
    options?: { htmlForAttachments?: string; preserveComposer?: boolean }
  ): Promise<boolean> => {
    if (isByokBlocked) return false;
    if (options?.preserveComposer && !searchHandoff?.preserveComposer) return false;
    const preserveComposer = options?.preserveComposer;

    // While a turn is streaming, composer Send/Enter appends to the FIFO queue
    // instead of starting a second stream (HTPR-5695). Use isTyping (not only
    // sendInFlight): the in-flight ref still blocks double-sends before the
    // stream starts, so a deferred+manual race cannot enqueue a duplicate of
    // the message that is still being prepared.
    if (retryContent === undefined && isTyping) {
      const content = (editor?.getText() ?? "").trim();
      if (!content) return false;
      const files = [...fileUpload.fileItems];
      const queued = {
        id: crypto.randomUUID(),
        content,
        html: editor?.getHTML() ?? "",
        files,
      };
      messageQueueRef.current = [...messageQueueRef.current, queued];
      setQueuedMessages(messageQueueRef.current);
      editor?.commands.clearContent();
      fileUpload.clearFiles();
      return true;
    }

    if (sendInFlightRef.current) return false;

    //Step 1: Process content and get context
    const htmlContent = retryContent ?? editor?.getHTML() ?? "";
    const editorHtmlForAttachments = retryContent
      ? options?.htmlForAttachments ?? ""
      : editor?.getHTML() ?? "";
    let content = editor?.getText() ?? htmlContent;

    if (retryContent) {
      content = retryContent;
    }

    if (!content.trim()) return false;
    sendInFlightRef.current = true;
    const taskAwareChatSurface =
      surface === "task_detail" || surface === "inbox";
    const streamTaskId =
      taskAwareChatSurface && inViewObject?.taskId
        ? inViewObject.taskId
        : undefined;

    try {
      const session = await waitForChatSession();
      if (!session) {
        toast.error("AI chat is still loading. Please try again.");
        if (preserveComposer) throw new Error("AI chat session is unavailable");
        return false;
      }

      if (isGuestBoardBuild(currentProject)) {
        await buildGuestBoard(content.trim(), session);
        return true;
      }

    const processedAttachments = preserveComposer ? [] : await processAttachments(
      editorHtmlForAttachments,
      fileUpload.fileItems
    );

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

    // Clear input
    // editor?.commands.blur();
    if (!preserveComposer) editor?.commands.clearContent();

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
    const assistantMessageId = crypto.randomUUID();

    // Add user message to the conversation
    const userMessage: IChatMessage = {
      id: Date.now().toString(),
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

    addMessageToSessionQuery(
      session.id,
      userMessage,
      false,
      false,
      scopedProjectId
    );

    // A task-scoped send (the ticket detail page) must never enter the
    // project-wide board map, or opening the docked chat on the board later
    // would resume this ticket's session instead of starting fresh (HTPR-6100).
    if (!isFullScreenChat && taskId === undefined && dockedProjectId !== undefined) {
      setAiChatBoardSessionMap((previousMap) => ({
        ...previousMap,
        [dockedProjectId]: session.id,
      }));
    }

    // Prepare the streaming API request payload (auth via Authorization: Bearer)
    const streamId = crypto.randomUUID();
    const payload = {
      message: content,
      aiFeature: "aiChat",
      teamId: modelTeamId,
      session_id: session.id,
      assistant_message_id: assistantMessageId,
      stream_id: streamId,
      context_list: contextList,
      modelOptionId: currentAiOption.id,
      model: currentAiOption.model,
      provider: currentAiOption.source,
      default_context: {
        // My Tasks, the inbox and the calendar span every board. Sending the
        // board the user happened to visit last would scope their questions to
        // it, which is the bug this surface field exists to end. A board they
        // picked deliberately in the scope selector still counts.
        project_id:
          spansAllBoards && !boardScopeIsExplicit ? undefined : scopedProjectId,
        surface,
        surface_path: pathname,
        // Active View = the saved filtered tab the user is on. Null appliedView means the default (all tasks) view, labelled by the board name.
        view_id: currentProject?.project_view?.user_project_views?.[0]?.appliedView?.id,
        view_name:
          currentProject?.project_view?.user_project_views?.[0]?.appliedView?.title ??
          currentProject?.title,
        ...(streamTaskId ? { task_id: streamTaskId } : {}),
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

    // Set current streaming session for cancellation
    streamingSessionRef.current = session.id;
    streamingAssistantMessageRef.current = assistantMessageId;
    setCurrentStreamingSession(session.id);
    streamingRequestRef.current = streamId;

    let assistantPlaceholderAdded = false;
    // HTPR-6278: the server's refusal message when it rejects the request
    // outright (busy, rate-limited, unavailable) — shown instead of the
    // misleading "Connection lost" text.
    let refusalMessage: string | null = null;
    try {
      const response = await fetch(chatRoute, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...mcpAuthorizationHeaders(token),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) {
        if (turnFailureState && !response.ok) {
          refusalMessage =
            (await extractStreamRefusalMessage(response)) ??
            "The chat server refused this reply. Wait a moment and try again.";
        }
        throw new Error("Network response was not ok or body is missing");
      }

      if (!preserveComposer) fileUpload.clearFiles();

      // Create a new assistant message to update incrementally. The same UUID
      // is sent to the stream route so server persistence is idempotent.
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
      await consumeAiChatStream({
        response: { body: response.body }, setAgentStatus, assistantMessageId, session, addMessageToSessionQuery,
        updateSessionTitle, setIsTyping, queryClient, streamTaskId, turnFailureState, reloadTaskAfterChat,
      });
    } catch (error) {
      setAgentStatus(undefined);
      console.error("Error generating AI response:", error);
      // HTPR-6278: a refused request carries the server's real message in its
      // body; only a genuine transport failure keeps the connection wording.
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
      // A transport failure does not mean server generation failed. Keep this
      // notice outside persistence and under a temporary id so it can never
      // compete with the durable background reply's UUID.
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
        setCurrentStreamingSession(null); // Clear streaming session
        console.log("Message has been completed");
      }
    } finally {
      sendInFlightRef.current = false;
      searchHandoff?.onSettled();
      // Auto-send the next queued follow-up once this turn settles (including
      // cancel/error). Keep the queue on Stop — only session switches clear it.
      queueMicrotask(() => {
        drainQueuedMessage();
      });
    }
    return true;
  };
  handleSendMessageRef.current = handleSendMessage;
  return {
  handleSendMessage,
  };
}

export type AiChatSendContext = Context;
