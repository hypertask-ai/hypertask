import { invalidateSlashSkills } from "@/lib/skills/slashSkills";
import { IChatMessage, IChatSession } from "@/models/model";
import { refreshTaskComments } from "@/lib/realtime/taskCommentsRefresh";
import { TASK_EVENT } from "@/lib/realtime/shared";
import { INBOX_QUERY_KEY } from "@/hooks/Inbox/useGetNotifications";
import { parseAiStreamErrorContent } from "./aiChatShared";
import type { AiChatSendContext } from "./aiChatSend";

type Context = Pick<AiChatSendContext, "setAgentStatus" | "addMessageToSessionQuery" | "updateSessionTitle" | "setIsTyping" | "queryClient" | "reloadTaskAfterChat" | "progressiveChatCreateEnabled" | "navigateToTask"> & {
  isCurrentStream?: () => boolean;
  response: { body: NonNullable<Response["body"]> };
  session: IChatSession;
  assistantMessageId: string;
  streamTaskId: number | undefined;
};

export async function consumeAiChatStream(context: Context) {
  const {
  isCurrentStream, response, setAgentStatus, assistantMessageId, session, addMessageToSessionQuery,
  updateSessionTitle, setIsTyping, queryClient, streamTaskId, reloadTaskAfterChat, progressiveChatCreateEnabled = false, navigateToTask,
  } = context;


      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let aiContent = "";
      let savedTaskContent = "";
      let buffer = "";
      let currentEventType = "";
      let replyAuthorAgent: { id: string; name: string } | null = null;
      let streamErrorHandled = false;
      let navigationFailed = false;
      let sawDone = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              if (trimmedLine.startsWith("event:")) {
                currentEventType = trimmedLine.slice(6).trim();
                console.log("🔥 Event type set to:", currentEventType);
                continue;
              }

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

                switch (currentEventType) {
                  case "status":
                    console.log(`🔥 Received status: ${parsed.content}`);
                    if (!isCurrentStream || isCurrentStream()) setAgentStatus(parsed.content);
                    break;
                  case "thinking":
                    console.log(`🔥 Received thinking: ${parsed.content}`);
                    break;
                  case "agent":
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
                  case "open_task": {
                    try {
                      if (!navigateToTask || !Number.isSafeInteger(parsed.projectId) || parsed.projectId <= 0 || !Number.isSafeInteger(parsed.uniqueIndex) || parsed.uniqueIndex <= 0) {
                        throw new Error("Task navigation is unavailable");
                      }
                      navigateToTask(parsed.projectId, parsed.uniqueIndex);
                    } catch {
                      navigationFailed = true;
                      streamErrorHandled = true;
                      addMessageToSessionQuery(session.id, {
                        id: assistantMessageId,
                        content: "I could not open the task. Please open it from the board.",
                        role: "assistant",
                        createdAt: new Date(),
                        sessionId: session.id,
                        isDelivered: true,
                      }, false, true);
                    }
                    break;
                  }
                  case "task_updated":
                    if (!progressiveChatCreateEnabled) break;
                    if (Number.isSafeInteger(parsed.taskId) && parsed.taskId > 0) {
                      window.dispatchEvent(new CustomEvent(TASK_EVENT, { detail: { taskId: parsed.taskId } }));
                    }
                    break;
                  case "task_created":
                  case "content":
                    if (navigationFailed || typeof parsed.content !== "string") break;
                    if (currentEventType === "task_created") {
                      if (!progressiveChatCreateEnabled) break;
                      savedTaskContent += parsed.content;
                    }
                    if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
                    aiContent += parsed.content;

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
                    if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
                    streamErrorHandled = true;
                    const rawError =
                      typeof parsed.content === "string" ? parsed.content : "";
                    const errorText = parseAiStreamErrorContent(rawError);
                    console.log("🔥 Received error event:", rawError);
                    const errorAssistantMessage: IChatMessage = {
                      id: assistantMessageId,
                      content: savedTaskContent + errorText,
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
                    if (!isCurrentStream || isCurrentStream()) setIsTyping(false);
                    break;
                  }
                  case "done":
                    invalidateSlashSkills();
                    if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
                    sawDone = true;
                    console.log("🔥 Stream complete:", parsed);
                    void queryClient
                      .refetchQueries({ queryKey: INBOX_QUERY_KEY, type: "active" })
                      .catch((error) =>
                        console.warn("[AI chat] inbox refresh failed", error)
                      );
                    if (parsed.status === "error") {
                      if (!streamErrorHandled && parsed.cancelled === true) {
                        const stoppedMessage: IChatMessage = {
                          id: assistantMessageId,
                          content:
                            aiContent.trim().length > 0
                              ? aiContent
                              : "Stream cancelled.",
                          role: "assistant",
                          createdAt: new Date(),
                          isDelivered: true,
                          sessionId: session.id,
                        };
                        addMessageToSessionQuery(
                          session.id,
                          stoppedMessage,
                          false,
                          true
                        );
                        streamErrorHandled = true;
                      } else if (!streamErrorHandled) {
                        const rawDone =
                          typeof parsed.content === "string"
                            ? parsed.content
                            : "";
                        const errorText = rawDone.trim()
                          ? parseAiStreamErrorContent(rawDone)
                          : "Sorry, an error occurred while processing your request.";
                        const errorMessage: IChatMessage = {
                          id: assistantMessageId,
                          content: savedTaskContent + errorText,
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
                    if (!isCurrentStream || isCurrentStream()) setIsTyping(false);
                    break;
                  default:
                    if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
                    console.warn(
                      "🔥 Unknown event type:",
                      currentEventType,
                      "Data:",
                      parsed
                    );
                }
              }
            } catch (error) {
              if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
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

      if (!sawDone && !streamErrorHandled) {
        const partial = aiContent.trim().length > 0;
        if (!isCurrentStream || isCurrentStream()) setAgentStatus(undefined);
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
