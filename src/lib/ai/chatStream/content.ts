import { z } from "zod";
import { type FilePart, type UserContent } from "ai";
import { ChatRequest, attachmentSchema } from "@/lib/ai/chatStream/request";
import { AuthedUser } from "@/lib/ai/chatStream/types";

export function formatTemporalContext(timezone = "UTC") {
  const now = new Date();
  const formattedDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
  const month = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "numeric",
    }).format(now)
  );
  const timePeriod =
    hour >= 5 && hour < 12
      ? "morning"
      : hour >= 12 && hour < 17
        ? "afternoon"
        : hour >= 17 && hour < 21
          ? "evening"
          : "night";
  const season =
    month === 12 || month <= 2
      ? "winter"
      : month <= 5
        ? "spring"
        : month <= 8
          ? "summer"
          : "fall";
  const weekend = dayOfWeek === "Saturday" || dayOfWeek === "Sunday";

  return (
    "<system-reminder>\n" +
    `Today's Date & Time: ${formattedDisplay}\n` +
    `Day of Week: ${dayOfWeek}\n` +
    `Time Period: ${timePeriod}\n` +
    `Season: ${season}\n` +
    `Timezone: ${timezone}\n` +
    `Weekend: ${weekend ? "Yes" : "No"}\n` +
    "</system-reminder>"
  );
}

export function formatChatHistory(chatHistory: ChatRequest["chat_history"]) {
  if (!chatHistory?.length) return "No previous conversation.";
  const messages = chatHistory
    .slice(-15)
    .map((message, index) => ({
      index,
      role: message.role?.toLowerCase() === "assistant" ? "assistant" : "human",
      content: message.content || "",
    }))
    .filter((message) => message.content.trim().length > 0);

  if (messages.length === 0) return "No readable conversation history.";

  const immediate = messages.slice(-3);
  const recent = messages.slice(Math.max(0, messages.length - 10), -3);
  const earlier = messages.slice(0, Math.max(0, messages.length - 10));
  const parts: string[] = [];

  parts.push("=== CURRENT TIME CONTEXT ===");
  parts.push(`[Current Time: ${new Date().toISOString()}]`);
  parts.push("");

  if (immediate.length) {
    parts.push("=== IMMEDIATE CONVERSATIONAL CONTEXT ===");
    parts.push("(This is the most important context for your response)");
    immediate.forEach((message, index) => {
      const roleLabel =
        message.role === "assistant"
          ? "YOU JUST RESPONDED"
          : index === immediate.length - 1
            ? "USER IS NOW ASKING"
            : "USER ASKED";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (recent.length) {
    parts.push("=== RECENT CONVERSATION HISTORY ===");
    recent.forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU SAID" : "USER SAID";
      parts.push(`${roleLabel}: ${message.content}`);
    });
    parts.push("");
  }

  if (earlier.length) {
    parts.push("=== EARLIER CONVERSATION ===");
    earlier.slice(-6).forEach((message) => {
      const roleLabel = message.role === "assistant" ? "YOU" : "USER";
      parts.push(`[${roleLabel}]: ${message.content}`);
    });
  }

  return parts.join("\n");
}

// Raise the provider's reasoning effort for a retry after an empty completion.
// Instant/low effort is the usual cause of an empty agentic completion.
export function withHigherEffort(
  providerOptions: Record<string, Record<string, any>> | undefined
): Record<string, Record<string, any>> | undefined {
  if (!providerOptions) return providerOptions;
  const next: Record<string, Record<string, any>> = { ...providerOptions };
  if (next.openai) {
    next.openai = { ...next.openai, reasoningEffort: "high" };
  }
  if (next.anthropic) {
    next.anthropic = {
      ...next.anthropic,
      effort: "high",
      thinking: { type: "adaptive" },
    };
  }
  return next;
}

export function stringifyForPrompt(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

export function createDocumentContext(body: ChatRequest) {
  const files = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ];
  if (files.length === 0) return "";
  return files
    .map((file) => {
      const type = file.mimeType || "unknown";
      const name = file.fileName || "unnamed attachment";
      return `- ${name} (${type})`;
    })
    .join("\n");
}

export function createUserPrompt(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
) {
  return `
                ${formatTemporalContext()}
                ${currentTaskContext
      ? `\n                CURRENT TICKET CONTEXT (the ticket the user is viewing — read this before answering questions about "this ticket"; do NOT search for it):\n${currentTaskContext}\n`
      : ""
    }
                User query: ${body.message}
                CHAT HISTORY: ${formatChatHistory(body.chat_history)}
                context_list: ${stringifyForPrompt(body.context_list)}
                default_context: ${stringifyForPrompt(body.default_context)}
                user_context: ${stringifyForPrompt({
      id: authedUser.id,
      email: authedUser.email,
      displayName: authedUser.displayName,
    })}
                document_context: ${createDocumentContext(body)}

                IMPORTANT: Analyze the history and provide a complete, context-aware HTML body response.
                IMPORTANT: Follow the tool selection hierarchy strictly.
                IMPORTANT: User context is provided already. If you want to know more about the user's boards, then use the list_boards tool.
                IMPORTANT: Take into account the documents and images provided by the user.
            `;
}

export function parseDataUrl(url: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  return {
    mediaType: match[1] || "application/octet-stream",
    isBase64: Boolean(match[2]),
    data: match[3] || "",
  };
}

export function filePartFromAttachment(
  attachment: z.infer<typeof attachmentSchema>
): FilePart | null {
  if (!attachment.url) return null;
  const mediaType = attachment.mimeType || "application/octet-stream";
  const dataUrl = parseDataUrl(attachment.url);
  if (dataUrl?.isBase64) {
    return {
      type: "file",
      mediaType: attachment.mimeType || dataUrl.mediaType,
      filename: attachment.fileName,
      data: { type: "data", data: dataUrl.data },
    };
  }

  try {
    return {
      type: "file",
      mediaType,
      filename: attachment.fileName,
      data: new URL(attachment.url),
    };
  } catch {
    return null;
  }
}

export function createUserContent(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string
): UserContent {
  const prompt = createUserPrompt(body, authedUser, currentTaskContext);
  const fileParts = [
    ...(body.images64 ?? []),
    ...(body.pdfs64 ?? []),
    ...(body.docx64 ?? []),
  ]
    .map(filePartFromAttachment)
    .filter((part): part is FilePart => part !== null);

  if (fileParts.length === 0) return prompt;
  return [{ type: "text", text: prompt }, ...fileParts];
}
