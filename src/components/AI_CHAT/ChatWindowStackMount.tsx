"use client";
import React, { Suspense, lazy } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { useChatWindows } from "@/hooks/MultiPages/AIChat/useChatWindows";

const ChatWindowStack = lazy(() => import("./ChatWindowStack"));

export default function ChatWindowStackMount({ userId }: { userId: number | null }) {
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const controller = useChatWindows(userId);
  const stackReady = multiChatWindowsEnabled && userId !== null && controller.enabled && controller.windows.length > 0;
  return stackReady ? (
    <Suspense fallback={null}>
      <ChatWindowStack userId={userId} />
    </Suspense>
  ) : null;
}
