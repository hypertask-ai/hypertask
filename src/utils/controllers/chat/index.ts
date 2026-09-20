import type { ModelMessage } from "ai";
import type { Prisma, PrismaClient } from "@prisma/client";

import prisma from "@/lib/prisma";

type ChatDatabase = Pick<
  PrismaClient | Prisma.TransactionClient,
  "chatSession" | "chatMessage" | "chatSessionParticipant"
>;

/** Shared persistence boundary for every chat transport. */
export function chatStore(database: ChatDatabase = prisma) {
  return {
    sessions: database.chatSession,
    messages: database.chatMessage,
    participants: database.chatSessionParticipant,
  };
}

export function buildChatHistoryMessages(
  history: ReadonlyArray<{ role: "human" | "assistant"; content: string }>,
): ModelMessage[] {
  return history
    .filter((message) => message.content.trim())
    .map((message) => ({
      role: message.role === "human" ? "user" : "assistant",
      content: message.content,
    }));
}
