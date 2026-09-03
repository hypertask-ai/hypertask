import { createHash } from "node:crypto";

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { requireHyperAiCommentConfirmation } from "@/lib/ai/hyperAiConfirmation";
import { createMcpToken } from "@/lib/mcp/auth";
import { MCP_TOOLS } from "@/lib/mcp-server/tools";
import { TOOL_METADATA } from "@/lib/mcp-server/config/tool-metadata";

type PortableMcpTool = {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: unknown,
    token: string,
    invocation?: {
      requestId: string;
      clientFingerprint: string;
      sessionId?: string;
    },
  ) => Promise<string>;
};

type HyperAiToolUser = {
  id: number;
  email: string;
};

type CreateHyperAiToolsInput = {
  user: HyperAiToolUser;
  actingAgentId: string | null;
  projectId: number;
  taskId: number;
  sourceMessageId: string;
  sourceMessageText: string;
  sourceMessageCreatedAt: Date | null;
  sourceMessageImmutable: boolean;
};

const ACCOUNT_MANAGEMENT_TOOLS = new Set<string>([
  TOOL_METADATA.LIST_AGENTS.name,
  TOOL_METADATA.CREATE_AGENT.name,
  TOOL_METADATA.REVOKE_AGENT.name,
  TOOL_METADATA.ARCHIVE_AGENT.name,
  TOOL_METADATA.DELETE_AGENT.name,
  TOOL_METADATA.MINT_TOKEN.name,
  TOOL_METADATA.REVOKE_TOKEN.name,
  TOOL_METADATA.LIST_CONNECTIONS.name,
]);

const HYPER_AI_SECRET_WEBHOOK_ACTIONS = new Set(["configure", "rotate"]);

// This is intentionally an allowlist: every current or future registry entry
// not proven read-only is treated as a mutation and requires confirmation.
const READ_ONLY_TOOLS = new Set<string>([
  TOOL_METADATA.HELLO.name,
  TOOL_METADATA.AGENT_PRESENCE.name,
  TOOL_METADATA.LIST_AGENTS.name,
  TOOL_METADATA.LIST_CONNECTIONS.name,
  TOOL_METADATA.GET_USER_CONTEXT.name,
  TOOL_METADATA.LIST_TASKS.name,
  TOOL_METADATA.GET_TASKS.name,
  TOOL_METADATA.TASK_CONTEXT.name,
  TOOL_METADATA.GET_TASK_TREE.name,
  TOOL_METADATA.NEXT_TASKS.name,
  TOOL_METADATA.SEARCH_TASKS.name,
  TOOL_METADATA.RAG_RETRIEVAL.name,
  TOOL_METADATA.SEARCH_HELP_DOCS.name,
  TOOL_METADATA.FIND_RELATED_TASKS.name,
  TOOL_METADATA.LIST_PROJECTS.name,
  TOOL_METADATA.BOARD_MANIFEST.name,
  TOOL_METADATA.GET_BOARD_PLAYBOOK.name,
  TOOL_METADATA.LIST_PROJECT_MEMBERS.name,
  TOOL_METADATA.LIST_LABELS.name,
  TOOL_METADATA.LIST_CUSTOM_FIELDS.name,
  TOOL_METADATA.INBOX_LIST.name,
  TOOL_METADATA.GET_COMMENTS.name,
  TOOL_METADATA.GET_PAGE.name,
  TOOL_METADATA.LIST_PAGES.name,
  TOOL_METADATA.SEARCH_PAGES.name,
  TOOL_METADATA.LIST_VIEWS.name,
  TOOL_METADATA.GET_VIEW.name,
  TOOL_METADATA.LIST_SKILLS.name,
  TOOL_METADATA.GET_SKILL.name,
]);

const HYBRID_READ_ACTIONS = new Map<string, ReadonlySet<string>>([
  [TOOL_METADATA.AGENT_WEBHOOK.name, new Set(["get"])],
  [TOOL_METADATA.TASK_DESCRIPTION_HISTORY.name, new Set(["versions"])],
  [TOOL_METADATA.LINK_TASKS.name, new Set(["list"])],
  [
    TOOL_METADATA.BOARD_CONFIG.name,
    new Set(["get_playbook", "get_instructions"]),
  ],
  [TOOL_METADATA.SECTION_CRUD.name, new Set(["list", "get"])],
  [TOOL_METADATA.PAGE_HISTORY.name, new Set(["versions"])],
  [TOOL_METADATA.REPORT_CRUD.name, new Set(["list", "get"])],
  [TOOL_METADATA.DECISION_REQUEST.name, new Set(["list", "get"])],
  [TOOL_METADATA.DRAFT_CRUD.name, new Set(["list"])],
  [TOOL_METADATA.TIME.name, new Set(["status", "running", "report"])],
]);

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function isHyperAiSecretWebhookOperation(toolName: string, input: unknown) {
  return (
    toolName === TOOL_METADATA.AGENT_WEBHOOK.name &&
    HYPER_AI_SECRET_WEBHOOK_ACTIONS.has(String(record(input).action))
  );
}

export function isHyperAiMutation(toolName: string, input: unknown): boolean {
  if (
    toolName === TOOL_METADATA.IMPORT_SKILLS.name &&
    record(input).dry_run === true
  ) {
    return false;
  }
  const readActions = HYBRID_READ_ACTIONS.get(toolName);
  if (!readActions) return !READ_ONLY_TOOLS.has(toolName);

  const action = record(input).action;
  return typeof action !== "string" || !readActions.has(action);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function buildHyperAiOperationKey(toolName: string, input: unknown) {
  return JSON.stringify([toolName, canonicalize(input)]);
}

function parseMcpToolResult(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { success: !value.startsWith("Error:"), content: value };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adapts the canonical MCP registry for HyperAI. MCP remains the capability
 * source of truth; this layer only adds the stronger confirmation contract
 * required for writes initiated from a ticket mention.
 */
export function createHyperAiTools({
  user,
  actingAgentId,
  projectId,
  taskId,
  sourceMessageId,
  sourceMessageText,
  sourceMessageCreatedAt,
  sourceMessageImmutable,
}: CreateHyperAiToolsInput): ToolSet {
  const sessionId = `hyperai:${projectId}:${taskId}`;
  const previewsIssuedThisRequest = new Set<string>();
  const token = createMcpToken(user.id, user.email, "15m");
  const clientFingerprint = createHash("sha256")
    .update(`hyperai:${user.id}`)
    .digest("hex");

  return Object.fromEntries(
    (MCP_TOOLS as unknown as PortableMcpTool[]).map((mcpTool) => {
      const mutationCapable = !READ_ONLY_TOOLS.has(mcpTool.name);
      const inputSchema = mutationCapable
        ? mcpTool.parameters.extend({
            confirmed: z
              .boolean()
              .optional()
              .describe(
                "Set true only after the user explicitly approved this exact proposed write in a later comment.",
              ),
          })
        : mcpTool.parameters;

      return [
        mcpTool.name,
        tool({
          description: `${mcpTool.description}${
            mcpTool.name === TOOL_METADATA.AGENT_WEBHOOK.name
              ? " HyperAI ticket comments cannot safely reveal signing secrets, so configure and rotate are available in private AI Chat, CLI, MCP, and agent settings instead."
              : ""
          }${
            mutationCapable
              ? " HyperAI write safety: the first exact write call returns a preview. Ask the user to confirm, end the turn, then repeat the same call with confirmed=true only after a later user comment approves it."
              : ""
          }`,
          inputSchema,
          execute: async (rawInput) => {
            if (
              actingAgentId &&
              ACCOUNT_MANAGEMENT_TOOLS.has(mcpTool.name)
            ) {
              return {
                success: false,
                error: "Native agents cannot access account management tools.",
              };
            }

            const { confirmed, ...rawMcpInput } = record(rawInput);
            if (isHyperAiSecretWebhookOperation(mcpTool.name, rawMcpInput)) {
              return {
                success: false,
                error:
                  "Signing secrets are never written into ticket comments. Configure or rotate this webhook in private AI Chat, the CLI, MCP, or agent settings.",
              };
            }
            if (
              actingAgentId &&
              mcpTool.name === TOOL_METADATA.AGENT_WEBHOOK.name &&
              rawMcpInput.agent_id !== undefined &&
              rawMcpInput.agent_id !== "self" &&
              rawMcpInput.agent_id !== actingAgentId
            ) {
              return {
                success: false,
                error: "A native agent can only manage its own webhook.",
              };
            }
            const mcpInput =
              actingAgentId &&
              mcpTool.name === TOOL_METADATA.AGENT_WEBHOOK.name &&
              (rawMcpInput.agent_id === undefined || rawMcpInput.agent_id === "self")
                ? { ...rawMcpInput, agent_id: actingAgentId }
                : rawMcpInput;
            const operationKey = buildHyperAiOperationKey(
              mcpTool.name,
              mcpInput,
            );

            if (isHyperAiMutation(mcpTool.name, mcpInput)) {
              const confirmation = await requireHyperAiCommentConfirmation({
                userId: user.id,
                sessionId,
                operationKey,
                sourceMessageId,
                sourceMessageText,
                sourceMessageCreatedAt,
                sourceMessageImmutable,
                confirmed: confirmed === true,
                previewsIssuedThisRequest,
              });
              if (confirmation === "preview") {
                return {
                  success: false,
                  confirmation_required: true,
                  tool: mcpTool.name,
                  proposed_input: mcpInput,
                  message:
                    "Nothing changed. Summarize this exact write, ask the user to confirm it in a new comment, and end the turn.",
                };
              }
            }

            const requestId = createHash("sha256")
              .update(`${sessionId}:${operationKey}`)
              .digest("hex");
            try {
              return parseMcpToolResult(
                await mcpTool.execute(mcpInput, token, {
                  requestId,
                  clientFingerprint,
                  sessionId,
                }),
              );
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          },
        }),
      ];
    }),
  );
}

export const HYPER_AI_TOOL_COUNT = MCP_TOOLS.length;
