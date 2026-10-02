"use client";
import { ComponentType, ReactNode, Suspense, useState } from "react";
import { ChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";

type ChatRuntimeComponent = ComponentType<{
  onValue: (value: ChatContextType | undefined) => void;
  children?: ReactNode;
}>;

// Keeps every page in one fixed place while the chat runtime loads. The runtime
// used to wrap the page, so when the chat auto-opened on a board React rebuilt
// the whole route and the board lost its columns and refetched (HTPR-6751).
//
// Pages that require the chat context (holdChildren: /chat, flagged mobile
// /agents/chat) mount the runtime from their first render, so they stay
// wrapped by it, keep their server render, and show `loading` until it exists.
// Every other page sits beside the runtime under a provider whose value the
// runtime fills in once it loads. The runtime itself stays in the same slot on
// every route, so a chat draft or stream survives navigation.
export default function ChatRuntimeHost({
  mounted,
  holdChildren,
  loading,
  Runtime,
  children,
}: {
  mounted: boolean;
  holdChildren: boolean;
  loading: ReactNode;
  Runtime: ChatRuntimeComponent;
  children: ReactNode;
}) {
  const [chatContext, setChatContext] = useState<ChatContextType>();
  return (
    <>
      {(mounted || holdChildren) && (
        <Suspense fallback={holdChildren ? loading : null}>
          <Runtime onValue={setChatContext}>
            {holdChildren ? children : null}
          </Runtime>
        </Suspense>
      )}
      {!holdChildren && (
        <ChatContext.Provider value={chatContext}>{children}</ChatContext.Provider>
      )}
    </>
  );
}
