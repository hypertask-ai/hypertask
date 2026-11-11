"use client";
import React, { Suspense, lazy, useEffect } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8334_MULTI_CHAT_WINDOWS_FLAG } from "@/lib/flags/definitions/htpr-8334-multi-chat-windows";
import { useChatWindows } from "@/hooks/MultiPages/AIChat/useChatWindows";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatWindowsAtom, isAiChatSidebarModeAtom } from "@/store";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8988-chat-window-layout";
import { closeChatWindowsForUser } from "@/lib/aiChat/chatWindows";

const ChatWindowStack = lazy(() => import("./ChatWindowStack"));

export default function ChatWindowStackMount({ userId }: { userId: number | null }) {
  const sideBySide = useFlag(HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG);
  const chat = useOptionalAiChatContext();
  const multiChatWindowsEnabled = useFlag(HTPR_8334_MULTI_CHAT_WINDOWS_FLAG);
  const controller = useChatWindows(userId);
  const sidebarMode = useRecoilValue(isAiChatSidebarModeAtom);
  const setStored = useSetRecoilState(aiChatWindowsAtom);
  useEffect(() => {
    if (!multiChatWindowsEnabled || !sidebarMode || userId === null) return;
    setStored((previous) => closeChatWindowsForUser(previous, userId));
  }, [multiChatWindowsEnabled, setStored, sidebarMode, userId]);
  const stackReady = multiChatWindowsEnabled && userId !== null && controller.enabled;
  return stackReady && (controller.windows.length > 0 || (sideBySide && chat?.showAiChatInterface)) ? (
    <Suspense fallback={null}>
      <ChatWindowStack userId={userId} />
    </Suspense>
  ) : null;
}
