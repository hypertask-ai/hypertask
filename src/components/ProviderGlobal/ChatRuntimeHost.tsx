"use client";
import { ComponentType, ReactNode, Suspense, useState } from "react";
import { ChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import type { ChatContextType } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";

type ChatRuntimeComponent = ComponentType<{
  onValue: (value: ChatContextType | undefined) => void;
  children?: ReactNode;
}>;

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
