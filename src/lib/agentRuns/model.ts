import type {
  AgentRun,
  AgentRunActivity,
  AgentRunActivityType,
  AgentRunStatus,
  AgentRunTrigger,
} from "@prisma/client";
import type {
  AgentWebhookEventInput,
  AgentWebhookRun,
} from "@/lib/agentWebhooks/events";

export const AGENT_RUN_FEATURE_FLAG = "htpr-6115-agent-sdk";
export const AGENT_RUN_STALE_AFTER_MS = 5 * 60 * 1000;
export const NONTERMINAL_AGENT_RUN_STATUSES: AgentRunStatus[] = [
  "ACTIVE",
  "STALE",
];
export const AGENT_RUN_ACTIVITY_TYPES = [
  "thought",
  "action",
  "response",
  "error",
  "elicitation",
] as const;
export const AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH = 8_000;
export const AGENT_RUN_ACTIVITY_LINK_MAX_LENGTH = 2_048;
export const AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH = 256;
export const AGENT_RUN_ACTIVITY_OPTIONS_MAX_COUNT = 10;

export type AgentRunActivityOption = {
  value: string;
  label: string;
};

export type AgentRunActivityInput = {
  type: AgentRunActivityType;
  text: string;
  link: string | null;
  options: AgentRunActivityOption[] | null;
};

export type SerializedAgentRunActivity = {
  id: string;
  runId: string;
  type: (typeof AGENT_RUN_ACTIVITY_TYPES)[number];
  text: string;
  link: string | null;
  options: AgentRunActivityOption[] | null;
  selectedOption: AgentRunActivityOption | null;
  selectedAt: string | null;
  selectedBy: number | null;
  createdAt: string;
};

export class AgentRunActivityInputError extends Error {}
export class AgentRunNotActiveError extends Error {}
export class AgentRunActivityConflictError extends Error {}
export class AgentRunSelectionConflictError extends Error {}

export type AgentRunContext =
  | { taskId: number; chatSessionId: null }
  | { taskId: null; chatSessionId: string };

export function agentRunTriggerForEvent(
  event: AgentWebhookEventInput["event"],
): AgentRunTrigger | null {
  if (event === "comment.mention") return "MENTION";
  if (event === "task.assigned") return "ASSIGNED";
  if (event === "chat.message") return "CHAT";
  return null;
}

export function agentRunContextForEvent(
  input: AgentWebhookEventInput,
): AgentRunContext | null {
  if (input.event === "chat.message" && input.chat?.sessionId) {
    return { taskId: null, chatSessionId: input.chat.sessionId };
  }
  if (
    (input.event === "comment.mention" || input.event === "task.assigned") &&
    input.taskId !== null
  ) {
    return { taskId: input.taskId, chatSessionId: null };
  }
  return null;
}

export function agentRunPromptForEvent(
  input: AgentWebhookEventInput,
): string | null {
  if (input.event === "comment.mention") return input.commentHtml ?? null;
  if (input.event === "chat.message") return input.chat?.text ?? null;
  return null;
}

export function serializeAgentRun(
  run: Pick<
    AgentRun,
    | "id"
    | "agentId"
    | "taskId"
    | "chatSessionId"
    | "trigger"
    | "status"
    | "createdAt"
    | "lastActivityAt"
    | "stoppedById"
  >,
): AgentWebhookRun {
  return {
    id: run.id,
    agentId: run.agentId,
    taskId: run.taskId,
    chatSessionId: run.chatSessionId,
    trigger: run.trigger.toLowerCase() as AgentWebhookRun["trigger"],
    status: run.status.toLowerCase() as AgentWebhookRun["status"],
    createdAt: run.createdAt.toISOString(),
    lastActivityAt: run.lastActivityAt.toISOString(),
    stoppedBy: run.stoppedById,
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseActivityOptions(value: unknown): AgentRunActivityOption[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AGENT_RUN_ACTIVITY_OPTIONS_MAX_COUNT
  ) {
    throw new AgentRunActivityInputError(
      `options must contain 1 to ${AGENT_RUN_ACTIVITY_OPTIONS_MAX_COUNT} choices`,
    );
  }

  const seen = new Set<string>();
  return value.map((rawOption) => {
    const option = objectRecord(rawOption);
    if (!option || Object.keys(option).some((key) => key !== "value" && key !== "label")) {
      throw new AgentRunActivityInputError(
        "each option must contain only value and label",
      );
    }
    const optionValue =
      typeof option.value === "string" ? option.value.trim() : "";
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (
      !optionValue ||
      !label ||
      optionValue.length > AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH ||
      label.length > AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH
    ) {
      throw new AgentRunActivityInputError(
        `option value and label must be 1 to ${AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH} characters`,
      );
    }
    if (seen.has(optionValue)) {
      throw new AgentRunActivityInputError("option values must be unique");
    }
    seen.add(optionValue);
    return { value: optionValue, label };
  });
}

export function parseAgentRunActivityInput(value: unknown): AgentRunActivityInput {
  const body = objectRecord(value);
  if (!body) throw new AgentRunActivityInputError("request body must be an object");
  const allowedFields = new Set(["type", "text", "link", "options"]);
  const unknownField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unknownField) {
    throw new AgentRunActivityInputError(`unknown field: ${unknownField}`);
  }

  const apiType = typeof body.type === "string" ? body.type : "";
  if (!(AGENT_RUN_ACTIVITY_TYPES as readonly string[]).includes(apiType)) {
    throw new AgentRunActivityInputError(
      `type must be one of: ${AGENT_RUN_ACTIVITY_TYPES.join(", ")}`,
    );
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH) {
    throw new AgentRunActivityInputError(
      `text must be 1 to ${AGENT_RUN_ACTIVITY_TEXT_MAX_LENGTH} characters`,
    );
  }

  let link: string | null = null;
  if (body.link !== undefined) {
    link = typeof body.link === "string" ? body.link.trim() : "";
    if (!link || link.length > AGENT_RUN_ACTIVITY_LINK_MAX_LENGTH) {
      throw new AgentRunActivityInputError(
        `link must be 1 to ${AGENT_RUN_ACTIVITY_LINK_MAX_LENGTH} characters`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      throw new AgentRunActivityInputError("link must be a valid http(s) URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AgentRunActivityInputError("link must be a valid http(s) URL");
    }
  }

  const type = apiType.toUpperCase() as AgentRunActivityType;
  if (link && type !== "ACTION") {
    throw new AgentRunActivityInputError("link is only valid for action activities");
  }
  const options =
    body.options === undefined ? null : parseActivityOptions(body.options);
  if (type === "ELICITATION" && !options) {
    throw new AgentRunActivityInputError(
      "options are required for elicitation activities",
    );
  }
  if (options && type !== "ELICITATION") {
    throw new AgentRunActivityInputError(
      "options are only valid for elicitation activities",
    );
  }

  return { type, text, link, options };
}

export function parseAgentRunSelection(value: unknown): string {
  const body = objectRecord(value);
  if (
    !body ||
    Object.keys(body).some((key) => key !== "value") ||
    typeof body.value !== "string"
  ) {
    throw new AgentRunActivityInputError("value is required");
  }
  const selectedValue = body.value.trim();
  if (
    !selectedValue ||
    selectedValue.length > AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH
  ) {
    throw new AgentRunActivityInputError(
      `value must be 1 to ${AGENT_RUN_ACTIVITY_OPTION_MAX_LENGTH} characters`,
    );
  }
  return selectedValue;
}

export function storedAgentRunActivityOptions(
  value: unknown,
): AgentRunActivityOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: AgentRunActivityOption[] = [];
  for (const rawOption of value) {
    const option = objectRecord(rawOption);
    if (
      !option ||
      typeof option.value !== "string" ||
      typeof option.label !== "string"
    ) {
      return null;
    }
    options.push({ value: option.value, label: option.label });
  }
  return options.length > 0 ? options : null;
}

export function serializeAgentRunActivity(
  activity: Pick<
    AgentRunActivity,
    | "id"
    | "runId"
    | "type"
    | "text"
    | "link"
    | "options"
    | "selectedValue"
    | "selectedLabel"
    | "selectedAt"
    | "selectedById"
    | "createdAt"
  >,
): SerializedAgentRunActivity {
  return {
    id: activity.id,
    runId: activity.runId,
    type: activity.type.toLowerCase() as SerializedAgentRunActivity["type"],
    text: activity.text,
    link: activity.link,
    options: storedAgentRunActivityOptions(activity.options),
    selectedOption:
      activity.selectedValue && activity.selectedLabel
        ? { value: activity.selectedValue, label: activity.selectedLabel }
        : null,
    selectedAt: activity.selectedAt?.toISOString() ?? null,
    selectedBy: activity.selectedById,
    createdAt: activity.createdAt.toISOString(),
  };
}

export function agentRunActivityMatchesInput(
  activity: Pick<AgentRunActivity, "type" | "text" | "link" | "options">,
  input: AgentRunActivityInput,
): boolean {
  return (
    activity.type === input.type &&
    activity.text === input.text &&
    activity.link === input.link &&
    JSON.stringify(storedAgentRunActivityOptions(activity.options)) ===
      JSON.stringify(input.options)
  );
}
