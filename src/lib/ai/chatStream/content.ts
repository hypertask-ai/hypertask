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

export function formatChatHistory(chatHistory: ChatRequest["chat_history"], includeTimeContext = true) {
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

  if (includeTimeContext) {
    parts.push("=== CURRENT TIME CONTEXT ===");
    parts.push(`[Current Time: ${new Date().toISOString()}]`);
    parts.push("");
  }

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
  currentTaskContext: string,
  promptCachingEnabled = false
) {
  if (promptCachingEnabled) {
    return `
                IMPORTANT: Analyze the history and provide a complete, context-aware HTML body response.
                IMPORTANT: Follow the tool selection hierarchy strictly.
                IMPORTANT: User context is provided already. If you want to know more about the user's boards, then use the list_boards tool.
                IMPORTANT: Take into account the documents and images provided by the user.
                ${body.default_context?.scope === "ticket"
      ? "SCOPE: Current ticket only. Use only the current ticket title, description and comments as ticket context. Do not search or load other tickets or board-wide context. This explicit scope overrides the default task_id navigation guidance."
      : ""
    }
                user_context: ${stringifyForPrompt({
      id: authedUser.id,
      email: authedUser.email,
      displayName: authedUser.displayName,
    })}
                CHAT HISTORY: ${formatChatHistory(body.chat_history, false)}
                default_context: ${stringifyForPrompt(body.default_context)}
                context_list: ${stringifyForPrompt(body.context_list)}
                ${currentTaskContext
      ? `\n                CURRENT TICKET CONTEXT (the ticket the user is viewing — read this before answering questions about "this ticket"; do NOT search for it):\n${currentTaskContext}\n`
      : ""
    }
                document_context: ${createDocumentContext(body)}
                User query: ${body.message}
                ${formatTemporalContext()}
                === CURRENT TIME CONTEXT ===
                [Current Time: ${new Date().toISOString()}]
            `;
  }
  return `
                ${formatTemporalContext()}
                ${currentTaskContext
      ? `\n                CURRENT TICKET CONTEXT (the ticket the user is viewing — read this before answering questions about "this ticket"; do NOT search for it):\n${currentTaskContext}\n`
      : ""
    }
                ${body.default_context?.scope === "ticket"
      ? "SCOPE: Current ticket only. Use only the current ticket title, description and comments as ticket context. Do not search or load other tickets or board-wide context. This explicit scope overrides the default task_id navigation guidance."
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
  currentTaskContext: string,
  promptCachingEnabled = false
): UserContent {
  const prompt = createUserPrompt(body, authedUser, currentTaskContext, promptCachingEnabled);
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

export async function createImageAwareUserContent(
  body: ChatRequest,
  authedUser: AuthedUser,
  currentTaskContext: string,
  modelId: string,
  signal: AbortSignal,
  promptCachingEnabled = false
): Promise<UserContent> {
  const supportsImages = /^(?:[^/]+\/)?(?:gpt-|claude-|gemini-|kimi-)/i.test(modelId);
  const textOnly = /^(?:[^/]+\/)?deepseek-/i.test(modelId);
  const imageUrls = new Set<string>();
  for (const match of body.message.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const candidate = /[?#]/.test(match[0]) ? match[0] : match[0].replace(/[),.;!?\]}]+$/, "");
    try {
      const url = new URL(candidate);
      if (/\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname)) imageUrls.add(url.href);
    } catch {
    }
  }

  const content = createUserContent(
    textOnly ? { ...body, images64: [] } : body,
    authedUser,
    currentTaskContext,
    promptCachingEnabled,
  );
  const parts: Exclude<UserContent, string> = typeof content === "string"
    ? [{ type: "text", text: content }]
    : [...content];
  const status: string[] = [];
  if (supportsImages) {
    status.push("IMAGE CAPABILITY: The selected model accepts images. Describe supplied image content; do not claim you cannot read images.");
  } else if (textOnly) {
    status.push("IMAGE CAPABILITY: The selected model is text-only. If images were supplied, explain that this selected model cannot see them and ask the user to select a vision-capable model.");
  } else {
    status.push("IMAGE CAPABILITY: Image support is unknown for the selected model. Existing image uploads were forwarded unchanged; do not claim that all chat models lack vision.");
  }

  const attachedUrls = new Set((body.images64 ?? []).map((image) => image.url));
  const candidates = [...imageUrls].filter((url) => !supportsImages || !attachedUrls.has(url));
  if (supportsImages && candidates.length) {
    const { safeFetchAttachmentUrl } = await import("@/lib/mcp/attachments/safeFetch");
    const images = await Promise.all(candidates.slice(0, 4).map(async (url) => {
      try {
        const result = await safeFetchAttachmentUrl(url, signal);
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(result.contentType)) {
          status.push(`Image URL ${url}: did not return a supported image. Ask for a direct image or upload.`);
          return null;
        }
        return {
          type: "file" as const,
          mediaType: result.contentType,
          data: { type: "data" as const, data: new Uint8Array(result.buffer) },
        };
      } catch (error) {
        if (signal.aborted) throw error;
        status.push(`Image URL ${url}: could not be downloaded safely. Explain that the link could not be read, not that the model lacks vision; ask for an upload.`);
        return null;
      }
    }));
    for (const image of images) {
      if (image) parts.push(image);
    }
    if (candidates.length > 4) status.push("Only the first four new image links were loaded. Ask the user to send the remaining images separately if needed.");
  } else if (!supportsImages && (imageUrls.size || body.images64?.length)) {
    status.push(textOnly
      ? "Images were supplied by the user but were not sent as image content to this selected model."
      : "Images were supplied by the user. Linked images were not downloaded because image support is unknown.");
  }
  parts.push({ type: "text", text: status.join("\n") });
  return parts;
}
