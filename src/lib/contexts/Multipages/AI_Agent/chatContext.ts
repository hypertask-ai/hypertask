"use client";
import { createContext, useContext } from "react";
import type { ChatContextType } from "./AI_Agent_Chat_Context";

export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useAiChatContext = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useAiChatContext must be used within a ChatProvider");
  }
  return context;
};

export const useOptionalAiChatContext = (): ChatContextType | undefined =>
  useContext(ChatContext);
