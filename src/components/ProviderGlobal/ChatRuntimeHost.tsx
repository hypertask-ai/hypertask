"use client";
import { ComponentType, ReactNode, Suspense, useState } from "react";
import { ChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";

type ChatRuntimeComponent = ComponentType<{
  onValue: (value: ChatContextType | undefined) => void;
}>;

// Holds ChatContext in one fixed place above every page. The chat runtime loads
// beside the page and only fills in the value, so mounting it never remounts
// the route: it used to wrap the page, and an open board lost its columns and
// refetched every time the chat auto-opened (HTPR-6751). Routes whose pages
// read the chat context keep showing `loading` until the value exists.
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
      {mounted && (
        <Suspense fallback={null}>
          <Runtime onValue={setChatContext} />
        </Suspense>
      )}
      {holdChildren && !chatContext ? (
        loading
      ) : (
        <ChatContext.Provider value={chatContext}>{children}</ChatContext.Provider>
      )}
    </>
  );
}
