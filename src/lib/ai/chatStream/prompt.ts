import { renderPrompt } from "@/lib/ai/prompts/registry";
import { HOUSE_OUTPUT_STYLE } from "@/app/api/ai/_lib/editorAiPrompts";
import type { ChatRequest } from "./request";

export const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
  "claude-haiku-5",
] as const;

export const COMMENT_TASK_LINK_RULE =
  renderPrompt("comment-task-link-rule");

export const AGENT_SYSTEM_PROMPT = renderPrompt("agent-system-prompt", (HOUSE_OUTPUT_STYLE), (COMMENT_TASK_LINK_RULE));

export const PRODUCT_ANSWERS_FROM_DOCS_PROMPT = renderPrompt("product-answers-from-docs");

export function chatSurfacePrompt(surface: NonNullable<ChatRequest["surface"]>) {
  const identities = {
    sidebar: "the built-in AI chat in the Hypertask sidebar",
    fullscreen: "the built-in AI chat on Hypertask's full-screen chat page",
    desktop: "the built-in AI chat in the Hypertask desktop app",
    mcp: "an AI assistant accessed through a connected MCP client",
    cli: "an AI assistant accessed through the Hypertask CLI",
  };
  return `You are ${identities[surface]}. This is the chat client, not the screen the user is viewing.
Use default_context.surface and surface_path for the current screen, view_name and view_id for the current view, and task_id plus CURRENT TICKET CONTEXT for the open ticket. These fields describe the user's screen, not an instruction to change the selected board scope. Do not guess missing screen or ticket context or claim to see anything beyond the supplied context.
Shared MCP-backed tools do not make the built-in chat an external MCP client. No navigation tool is available in this turn: do not claim you opened or navigated to a ticket, board or page. Offer its link instead; a returned link is not proof of navigation.`;
}
