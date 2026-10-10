import { IChatMessage, IChatSession } from "@/models/model";
import { refreshTaskComments } from "@/lib/realtime/taskCommentsRefresh";
import { TASK_EVENT } from "@/lib/realtime/shared";
import { INBOX_QUERY_KEY } from "@/hooks/Inbox/useGetNotifications";
import { parseAiStreamErrorContent } from "./aiChatShared";
import type { AiChatSendContext } from "./aiChatSend";

type Context = Pick<AiChatSendContext, "setAgentStatus" | "addMessageToSessionQuery" | "updateSessionTitle" | "setIsTyping" | "queryClient" | "turnFailureState" | "reloadTaskAfterChat"> & {
  response: { body: NonNullable<Response["body"]> };
  session: IChatSession;
  assistantMessageId: string;
  streamTaskId: number | undefined;
};

export async function consumeAiChatStream(context: Context) {
  const {
  response, setAgentStatus, assistantMessageId, session, addMessageToSessionQuery,
  updateSessionTitle, setIsTyping, queryClient, streamTaskId, turnFailureState, reloadTaskAfterChat,
  } = context;


      // Process the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let aiContent = "";
      let buffer = "";
      let currentEventType = "";
      // HTPR-6284: set by the "agent" frame that precedes a routed @mention
      // reply. Scoped to this send, so it cannot leak into another message.
      let replyAuthorAgent: { id: string; name: string } | null = null;
      let streamErrorHandled = false;
      let sawDone = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          // Decode the chunk and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete lines from the buffer
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              // Check if it's an SSE event line
              if (trimmedLine.startsWith("event:")) {
                currentEventType = trimmedLine.slice(6).trim();
                console.log("🔥 Event type set to:", currentEventType);
                continue;
              }

              // Check if it's a data line
              if (trimmedLine.startsWith("data:")) {
                const jsonData = trimmedLine.slice(5).trim();
                if (!jsonData) {
                  console.log("🔥 Empty data line, skipping");
                  continue;
                }

                console.log(
                  "🔥 Processing data with event type:",
                  currentEventType,
                  "Data:",
                  jsonData
                );
                const parsed = JSON.parse(jsonData);

                // Handle the message based on the event type instead of parsed.type
                switch (currentEventType) {
                  case "status":
                    console.log(`🔥 Received status: ${parsed.content}`);
                    setAgentStatus(parsed.content);
                    break;
                  case "thinking":
                    console.log(`🔥 Received thinking: ${parsed.content}`);
                    break;
                  case "agent":
                    // HTPR-6284: the reply about to stream comes from this
                    // fleet agent, not the assistant.
                    if (
                      typeof parsed.agentId === "string" &&
                      typeof parsed.agentName === "string"
                    ) {
                      replyAuthorAgent = {
                        id: parsed.agentId,
                        name: parsed.agentName,
                      };
                    }
                    break;
                  case "content":
                    setAgentStatus(undefined);
                    aiContent += parsed.content;
                    // console.log(`🔥 aiContent after: "${aiContent}"`);

                    const initialAssistantMessage: IChatMessage = {
                      id: assistantMessageId,
                      content: aiContent,
                      role: "assistant",
                      createdAt: new Date(),
                      sessionId: session.id,
                      isDelivered: false,
                      ...(replyAuthorAgent
                        ? {
                            authorAgent: {
                              displayName: replyAuthorAgent.name,
                            },
                          }
                        : {}),
                    };

                    addMessageToSessionQuery(
                      session.id,
                      initialAssistantMessage,
                      true,
                      true
                    );
                    break;
                  case "title":
                    updateSessionTitle(session.id, parsed.content);
                    break;
                  case "complete":
                    break;
                  case "error": {
                    setAgentStatus(undefined);
                    streamErrorHandled = true;
                    const rawError =
                      typeof parsed.content === "string" ? parsed.content : "";
                    const errorText = parseAiStreamErrorContent(rawError);
                    console.log("🔥 Received error event:", rawError);
                    const errorAssistantMessage: IChatMessage = {
                      id: assistantMessageId,
                      content: errorText,
                      role: "assistant",
                      createdAt: new Date(),
                      sessionId: session.id,
                      isDelivered: true,
                    };
                    addMessageToSessionQuery(
                      session.id,
                      errorAssistantMessage,
                      false,
                      true
                    );
                    setIsTyping(false);
                    break;
                  }
                  case "done":
                    setAgentStatus(undefined);
                    sawDone = true;
                    console.log("🔥 Stream complete:", parsed);
                    // HTPR-6095: chat-driven inbox changes (archive/unarchive)
                    // only reach this tab via the Pusher broadcast, which
                    // competes with token-by-token render work while the reply
                    // streams in, so the badge can lag well after the turn
                    // ends. Self-correct here with the same query key the
                    // realtime handler uses; "active" keeps it to mounted
                    // queries only.
                    void queryClient
                      .refetchQueries({ queryKey: INBOX_QUERY_KEY, type: "active" })
                      .catch((error) =>
                        console.warn("[AI chat] inbox refresh failed", error)
                      );
                    if (parsed.status === "error") {
                      if (!streamErrorHandled) {
                        const rawDone =
                          typeof parsed.content === "string"
                            ? parsed.content
                            : "";
                        const errorText = rawDone.trim()
                          ? parseAiStreamErrorContent(rawDone)
                          : "Sorry, an error occurred while processing your request.";
                        const errorMessage: IChatMessage = {
                          id: assistantMessageId,
                          content: errorText,
                          role: "assistant",
                          createdAt: new Date(),
                          isDelivered: true,
                          sessionId: session.id,
                        };
                        addMessageToSessionQuery(
                          session.id,
                          errorMessage,
                          false,
                          true
                        );
                        streamErrorHandled = true;
                      }
                    } else if (!streamErrorHandled) {
                      const initialAssistantMessage: IChatMessage = {
                        id: assistantMessageId,
                        content: aiContent,
                        role: "assistant",
                        createdAt: new Date(),
                        sessionId: session.id,
                        isDelivered: true,
                        // Keep the routed @mention attribution through the
                        // final replacement (HTPR-6284).
                        ...(replyAuthorAgent
                          ? {
                              authorAgent: {
                                displayName: replyAuthorAgent.name,
                              },
                            }
                          : {}),
                      };

                      addMessageToSessionQuery(
                        session.id,
                        initialAssistantMessage,
                        parsed.assistant_persisted === true,
                        true
                      );
                      if (streamTaskId != null) {
                        // Reuse the open task's draft-safe refresh even if its websocket event was missed.
                        if (reloadTaskAfterChat) {
                          window.dispatchEvent(new CustomEvent(TASK_EVENT, { detail: { taskId: streamTaskId } }));
                        }
                        void refreshTaskComments(queryClient, streamTaskId).catch(
                          (error) =>
                            console.warn(
                              "[AI chat] task comments refresh failed",
                              error
                            )
                        );
                      }
                    }
                    setIsTyping(false);
                    break;
                  default:
                    setAgentStatus(undefined);
                    console.warn(
                      "🔥 Unknown event type:",
                      currentEventType,
                      "Data:",
                      parsed
                    );
                }
              }
            } catch (error) {
              setAgentStatus(undefined);
              console.error(
                "🔥 Error processing stream line:",
                error,
                "Line:",
                trimmedLine
              );
            }
          }
        }
      }

      // HTPR-6278: a stream that ends without a done frame is a failed turn.
      // Without this the thread looks wedged with no explanation. Partial
      // content stays visible; the notice appends below it under a temporary
      // id so it can never compete with a durably persisted reply.
      if (turnFailureState && !sawDone && !streamErrorHandled) {
        const partial = aiContent.trim().length > 0;
        setAgentStatus(undefined);
        addMessageToSessionQuery(
          session.id,
          {
            id: partial
              ? `transport-${assistantMessageId}`
              : assistantMessageId,
            content:
              "The reply stream ended before the reply finished. Try again.",
            role: "assistant",
            createdAt: new Date(),
            sessionId: session.id,
            isDelivered: true,
          } as IChatMessage,
          false,
          !partial
        );
      }
}
