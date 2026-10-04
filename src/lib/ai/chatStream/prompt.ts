import { renderPrompt } from "@/lib/ai/prompts/registry";
import { HOUSE_OUTPUT_STYLE } from "@/app/api/ai/_lib/editorAiPrompts";

export const CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES = [
  "claude-opus",
  "claude-sonnet-5",
] as const;

export const COMMENT_TASK_LINK_RULE =
  renderPrompt("comment-task-link-rule");

export const AGENT_SYSTEM_PROMPT = renderPrompt("agent-system-prompt", (HOUSE_OUTPUT_STYLE), (COMMENT_TASK_LINK_RULE));
