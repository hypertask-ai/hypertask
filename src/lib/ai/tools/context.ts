import { NextRequest } from "next/server";
import { createAgentForUser } from "@/lib/mcp/agents/create";
import { revokeAgentForUser } from "@/lib/mcp/agents/revoke";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { type HeartbeatTurnMetadata } from "@/lib/nativeAgent/heartbeatTurnEnvelope";
import { toolStatus } from "@/lib/ai/tools/metadata";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";
import { AuthedUser, ToolExecutionRecorder, ToolStartRecorder } from "@/lib/ai/chatStream/types";
import { ChatRequest, SendSse } from "@/lib/ai/chatStream/request";

import { createTaskAssigneeMutation } from "./taskAssignees";

export function createToolContext(
  user: AuthedUser,
  body: ChatRequest,
  send: SendSse,
  recordToolExecution: ToolExecutionRecorder,
  // Set when this ChatSession targets a native agent: mutations the model
  // makes (comments, assignments, moves, task creation) are attributed to
  // this agent instead of the human user driving the conversation.
  actingAgentId: string | null = null,
  recordToolStart?: ToolStartRecorder,
  heartbeatTurn?: HeartbeatTurnMetadata
) {
  const requestingUserId = user.id;
  const sendStatus = (toolName: string) => {
    const content = toolStatus[toolName];
    if (content) send("status", { content });
  };

  // HTPR-4218: a wide or destructive write must be shown to the user before it
  // runs. Keys of previews issued during THIS request, so the model cannot
  // preview and then confirm itself in the same turn -- confirmation has to
  // come back from the user in a new message.
  const bulkPreviewsIssued = new Set<string>();
  const confirmationSessionId = body.session_id ?? "no-session";
  const invokeAgentManagementHandler = async (
    operation: "create" | "revoke",
    input: Record<string, unknown>
  ) => {
    const request = new NextRequest(
      "http://localhost/api/mcp/admin/agents",
      {
        method: operation === "create" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );
    const response =
      operation === "create"
        ? await createAgentForUser(request, user)
        : await revokeAgentForUser(request, user);
    return sanitizeForJson(await response.json());
  };

  const requireAccountManagementConfirmation = async (
    operation: string,
    input: Record<string, unknown>,
    confirmed: boolean | undefined,
    message: string
  ) => {
    const outcome = await requireCrossMessageConfirmation({
      userId: user.id,
      sessionId: confirmationSessionId,
      operationKey: `account-management:${operation}:${JSON.stringify(input)}`,
      confirmed,
      previewsIssuedThisRequest: bulkPreviewsIssued,
    });
    return outcome === "preview"
      ? sanitizeForJson({
        success: false,
        confirmation_required: true,
        message:
          `${message} Nothing has been changed yet. ` +
          "End your turn now and ask the user to confirm. Only after they say yes in a new message, repeat this exact tool call with confirmed=true.",
      })
      : null;
  };
  const mutateTaskAssignees = createTaskAssigneeMutation({ user, actingAgentId, requestingUserId, confirmationSessionId, bulkPreviewsIssued });
  return { user, body, send, recordToolExecution, actingAgentId, recordToolStart, heartbeatTurn, requestingUserId, sendStatus, bulkPreviewsIssued, confirmationSessionId, invokeAgentManagementHandler, requireAccountManagementConfirmation, mutateTaskAssignees };
}

export type ToolContext = ReturnType<typeof createToolContext>;
