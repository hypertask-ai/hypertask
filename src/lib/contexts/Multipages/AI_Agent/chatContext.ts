"use client";
import { createContext, useContext } from "react";
import type { ChatContextType } from "./AI_Agent_Chat_Context";

// Kept apart from the chat runtime so the app shell can hold this provider in
// one fixed spot from the first render. The heavy runtime loads later and only
// fills in the value, so pages under it are never rebuilt (HTPR-6751).
export const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useAiChatContext = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error("useAiChatContext must be used within a ChatProvider");
  }
  return context;
};

// For shell pieces that render before the chat runtime has loaded.
export const useOptionalAiChatContext = (): ChatContextType | undefined =>
  useContext(ChatContext);
