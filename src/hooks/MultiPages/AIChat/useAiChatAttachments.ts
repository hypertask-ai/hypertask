import { sidebarChatHeaders } from "@/lib/agents/chatViewerState";
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

type Context = Pick<ReturnType<typeof useAiChatState>, "streamingSessionRef" | "currentStreamingSession" | "streamingAssistantMessageRef" | "streamingRequestRef" | "setIsTyping" | "setAgentStatus" | "token" | "editor" | "setIsRecording" | "addMessageToSessionQuery" | "scopedProjectId" | "dispatchInteraction"> &
  Pick<ReturnType<typeof useAiChatSessions>, "chatRoute" | "ensureSessionForCurrentBoard">;

export function useAiChatAttachments(context: Context) {
  const {
  streamingSessionRef, currentStreamingSession, streamingAssistantMessageRef, streamingRequestRef,
  setIsTyping, setAgentStatus, chatRoute, token, editor,
  setIsRecording, addMessageToSessionQuery, scopedProjectId, ensureSessionForCurrentBoard,
  dispatchInteraction,
  } = context;


  const handleCancelStream = async () => {
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
      dispatchInteraction({ type: "CANCEL_STREAM" });
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
            ...sidebarChatHeaders(sessionId),
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
