import { useCallback } from "react";
import { IChatSession } from "@/models/model";
import toast from "react-hot-toast";
import { mcpAuthorizationHeaders } from "@/lib/mcp/bearerAuth";
import { FileItem } from "@/components/Common/AttachmentsUpload/FileUploadHandler";
import { convertFileToBase64, getFileTypeFromBase64 } from "@/utils/helperFunctions/helperFunctions";
import { getFileTypeFromUrl, IMAGE_FALLBACK_MIME } from "@/utils/helperFunctions/getFileTypeFromUrl";
import { generateGuestBoard } from "@/lib/demo/guestBoardBuild";
import type { useAiChatState } from "./useAiChatState";
import type { useAiChatSessions } from "./useAiChatSessions";
import { AiChatProcessedAttachment } from "./aiChatShared";

type Context = Pick<ReturnType<typeof useAiChatState>, "streamingSessionRef" | "currentStreamingSession" | "streamingAssistantMessageRef" | "streamingRequestRef" | "setCurrentStreamingSession" | "setIsTyping" | "setAgentStatus" | "token" | "editor" | "setIsRecording" | "addMessageToSessionQuery" | "scopedProjectId"> &
  Pick<ReturnType<typeof useAiChatSessions>, "chatRoute" | "ensureSessionForCurrentBoard">;

export function useAiChatAttachments(context: Context) {
  const {
  streamingSessionRef, currentStreamingSession, streamingAssistantMessageRef, streamingRequestRef, setCurrentStreamingSession,
  setIsTyping, setAgentStatus, chatRoute, token, editor,
  setIsRecording, addMessageToSessionQuery, scopedProjectId, ensureSessionForCurrentBoard,
  } = context;


  const handleCancelStream = async () => {
    // The ref, not the state: a stream started microseconds ago has already set the ref
    // but may not have committed the state yet, and that stream is exactly the one an
    // unmount needs to cancel.
    const sessionId = streamingSessionRef.current ?? currentStreamingSession;
    if (!sessionId) return;
    const assistantMessageId = streamingAssistantMessageRef.current;
    const streamId = streamingRequestRef.current;
    if (!assistantMessageId || !streamId) {
      toast.error("Couldn’t identify the active reply. Try Stop again.");
      return;
    }
    const clearStreamingState = () => {
      if (
        streamingSessionRef.current !== sessionId ||
        streamingAssistantMessageRef.current !== assistantMessageId ||
        streamingRequestRef.current !== streamId
      ) {
        return;
      }
      streamingSessionRef.current = null;
      streamingAssistantMessageRef.current = null;
      streamingRequestRef.current = null;
      setCurrentStreamingSession(null);
      setIsTyping(false);
      setAgentStatus(undefined);
    };

    try {
      const response = await fetch(
        `${chatRoute.replace(
          "/stream",
          "/cancel"
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...mcpAuthorizationHeaders(token),
          },
          body: JSON.stringify({
            session_id: sessionId,
            assistant_message_id: assistantMessageId,
            stream_id: streamId,
          }),
        }
      );

      const result = await response.json();
      if (response.status === 409 && result?.status === "completed") {
        clearStreamingState();
        return;
      }
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "The active reply could not be stopped");
      }
      console.log("🔥 Cancel response:", result);

      // Reset streaming state
      clearStreamingState();
    } catch (error) {
      console.error("🔥 Error cancelling stream:", error);
      toast.error("Couldn’t stop the reply. Try Stop again.");
    }
  };

  const audioTiptapCallback = (text: string, setContent: boolean = false) => {
    if (editor) {
      setContent
        ? editor.chain().setContent(text).focus("end").run()
        : editor.chain().focus().insertContent(text).run();
    }
  };

  const toggleRecording = (val: boolean) => setIsRecording(val);

  const processAttachments = useCallback(
    async (
      editorHtml: string,
      fileItems: FileItem[]
    ): Promise<AiChatProcessedAttachment[]> => {
      const results: AiChatProcessedAttachment[] = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(editorHtml || "", "text/html");
      const imgTags = doc.querySelectorAll("img");
      let countBase64 = 0;

      for (const img of imgTags) {
        const url = img.getAttribute("src") || "";
        if (!url) continue;
        if (url.includes("ai-chat/attachments")) {
          // The file is already in storage, so send its URL. Fetching it back to base64
          // threw "Failed to fetch" on every attachment: the host serves no CORS header,
          // so the browser blocks the read (HTPR-4735). Both the chat route and the
          // persist route accept a hosted URL, and skipping the inline copy also keeps
          // the request small.
          const mimeType = getFileTypeFromUrl(url, IMAGE_FALLBACK_MIME);
          const fileName = url.substring(url.lastIndexOf("/") + 1);
          results.push({
            fileName,
            url,
            mimeType,
          });
        } else {
          const mimeType = getFileTypeFromBase64(url);
          results.push({
            fileName: `unknown-base64-${countBase64}`,
            url,
            mimeType,
          });
          countBase64++;
        }
      }

      for (const { file } of fileItems) {
        const dataUrl = (await convertFileToBase64(file)) as string;
        const mimeType =
          file.type ||
          getFileTypeFromBase64(dataUrl) ||
          "application/octet-stream";
        results.push({
          fileName: file.name,
          url: dataUrl,
          mimeType,
        });
      }

      return results;
    },
    []
  );

  // HTPR-4882: a guest's first words on their still-empty board build the board
  // instead of chatting about nothing. Posts the message into the thread first
  // so the chat shows what was asked plus the typing indicator while the
  // generator runs, then hard-navigates so the filled board loads clean.
  const buildGuestBoard = async (purpose: string, session: IChatSession) => {
    editor?.commands.clearContent();
    addMessageToSessionQuery(
      session.id,
      {
        id: Date.now().toString(),
        content: purpose,
        role: "human",
        createdAt: new Date(),
        sessionId: session.id,
        isDelivered: true,
      },
      false,
      false,
      scopedProjectId
    );
    setIsTyping(true);
    try {
      window.location.assign(await generateGuestBoard(purpose));
    } catch (error) {
      console.error("Error generating guest board:", error);
      setIsTyping(false);
      addMessageToSessionQuery(
        session.id,
        {
          id: Date.now().toString(),
          content:
            error instanceof Error
              ? error.message
              : "Could not create your board",
          role: "assistant",
          createdAt: new Date(),
          sessionId: session.id,
          isDelivered: true,
        },
        false,
        false,
        scopedProjectId
      );
    }
  };

  const waitForChatSession = async (timeoutMs = 5000) => {
    return ensureSessionForCurrentBoard(timeoutMs);
  };
  return {
  handleCancelStream, audioTiptapCallback, toggleRecording, processAttachments, buildGuestBoard,
  waitForChatSession,
  };
}
