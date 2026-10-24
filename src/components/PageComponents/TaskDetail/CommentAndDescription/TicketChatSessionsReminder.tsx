"use client";

import { taskSessionQueryOptions } from "@/components/AI_CHAT/WelcomeScreen";
import { useFlag } from "@/hooks/useFlag";
import { useOptionalAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/chatContext";
import { HTPR_7318_TICKET_CHAT_REMINDER_FLAG } from "@/lib/flags/definitions/htpr-7318-ticket-chat-reminder";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import { aiChatAutoOpenSuppressedAtom, aiChatEditTaskIdAtom, aiChatExplicitOpenAtAtom, currentUserAtom, isAiChatSidebarModeAtom, showAIChatInterfaceAtom } from "@/store";
import formatDateDifference from "@/utils/generateTime";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export const TicketChatSessionsReminder = ({ taskId }: { taskId: number }) => {
  const enabled = useFlag(HTPR_7318_TICKET_CHAT_REMINDER_FLAG);
  const user = useRecoilValue(currentUserAtom);
  const chat = useOptionalAiChatContext();
  const chatOpen = useRecoilValue(showAIChatInterfaceAtom);
  const setChatOpen = useSetRecoilState(showAIChatInterfaceAtom);
  const setSuppressed = useSetRecoilState(aiChatAutoOpenSuppressedAtom);
  const setExplicitOpenAt = useSetRecoilState(aiChatExplicitOpenAtAtom);
  const setSidebarMode = useSetRecoilState(isAiChatSidebarModeAtom);
  const setEditTaskId = useSetRecoilState(aiChatEditTaskIdAtom);
  const [pending, setPending] = useState<{ sessionId: string; taskId: number; userId: number; opened: boolean } | null>(null);
  const sessions = useQuery({
    ...taskSessionQueryOptions(taskId, user?.id),
    enabled: enabled && Boolean(user?.id) && taskId > 0,
  });

  useEffect(() => {
    if (enabled && user?.id && chat?.sendSettledVersion) void sessions.refetch();
  }, [enabled, user?.id, taskId, chat?.sendSettledVersion, sessions.refetch]);

  useEffect(() => {
    if (!pending) return;
    if (!enabled || pending.taskId !== taskId || pending.userId !== user?.id) {
      setPending(null);
      return;
    }
    if (!pending.opened) {
      setEditTaskId(null);
      setSidebarMode(true);
      setSuppressed(false);
      setExplicitOpenAt(Date.now());
      setChatOpen(true);
      setPending({ ...pending, opened: true });
      return;
    }
    if (!chatOpen) {
      setPending(null);
      return;
    }
    if (!chat?.chatHistoryReady) return;
    setPending(null);
    const sidebarResumed = !window.dispatchEvent(
      new CustomEvent("ht-ticket-chat-resume", { cancelable: true, detail: { sessionId: pending.sessionId } }),
    );
    if (!sidebarResumed) chat.selectSession(pending.sessionId);
    chat.restoreChat();
  }, [pending, enabled, chatOpen, taskId, user?.id, chat, setEditTaskId, setSidebarMode, setSuppressed, setExplicitOpenAt, setChatOpen]);

  if (!user || !sessions.data?.length) return null;

  const resume = (sessionId: string) => {
    setPending({ sessionId, taskId, userId: user.id, opened: false });
  };

  return enabled ? (
    <section aria-label="You chatted about this ticket" className="flex flex-col gap-1 px-2 py-3">
      <h2 className="px-2 text-xs text-text-light-gray">You chatted about this ticket</h2>
      <p className="px-2 text-[11px] text-text-light-gray">Only you see this</p>
      {sessions.data.map((session) => (
        <button
          key={session.id}
          type="button"
          className="flex w-full items-center gap-3 rounded p-2 text-left text-xs text-text-light-gray hover:bg-hover-active hover:text-white-black"
          onClick={() => resume(session.id)}
        >
          <span className="min-w-0 flex-1 truncate">
            {session.title}
          </span>
          <span className="shrink-0 text-[11px]">
            {formatDateDifference(session.updatedAt)}
          </span>
        </button>
      ))}
    </section>
  ) : null;
};
