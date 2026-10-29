import toast from "react-hot-toast";
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRecoilState } from "@/lib/state";
import { aiChatPinnedSessionIdsAtom } from "@/store";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { CHAT_SHORTCUTS, adjacentChatSession, chatShortcutHint, dispatchChatShortcut, type ChatShortcutId } from "@/lib/aiChat/chatShortcuts";
import OptionPickerModal from "@/components/Modals/OptionPicker";
import { DIV_ID_CONSTANTS } from "@/lib/configs/general.config";
import { SLASH_MENU_DOM_ID } from "@/lib/skills/slashSkills";

export function useChatShortcuts(options: {
  enabled: boolean;
  active?: boolean;
  onNewChat?: () => void | Promise<unknown>;
  onSelectSession?: (id: string) => void;
  sessionIds?: string[];
  onSearch?: () => void;
}) {
  const enabled = options.enabled && options.active !== false;
  const isApple = useDeviceContext();
  const chat = useAiChatContext();
  const [pinnedIds, setPinnedIds] = useRecoilState(aiChatPinnedSessionIdsAtom);
  const [picker, setPicker] = useState<"search" | "help" | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const starting = useRef(false);
  const sessions = [...(chat.sessionPagingEnabled ? chat.historySessions : chat.sessions)]
    .filter((session) => !session.agentId)
    .sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const focusComposer = () => {
    requestAnimationFrame(() => {
      const composers = rootRef.current?.querySelectorAll<HTMLElement>(".ProseMirror[contenteditable='true'], textarea");
      const composer = Array.from(composers ?? []).find((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
      composer?.focus({ preventScroll: true });
    });
  };
  const closePicker = () => {
    setPicker(null);
    focusComposer();
  };
  const selectSession = (id: string) => {
    (options.onSelectSession ?? chat.selectSession)(id);
    focusComposer();
  };
  const currentEvent = useRef<ReactKeyboardEvent<HTMLElement> | null>(null);
  const run = (id: ChatShortcutId): boolean => {
    const root = rootRef.current;
    if (!root) return false;
    const click = (selector: string) => {
      const button = root.querySelector<HTMLButtonElement>(selector);
      if (!button && chat.minimized) {
        chat.restoreChat();
        requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(selector)?.click());
        return true;
      }
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      button.click();
      return true;
    };
    switch (id) {
      case "new":
        if (starting.current) return true;
        starting.current = true;
        chat.restoreChat();
        focusComposer();
        void Promise.resolve().then(() => (options.onNewChat ?? chat.startNewSession)()).catch(() => {
          toast.error("Couldn’t start a new chat. Try again.");
        }).finally(() => {
          starting.current = false;
        });
        return true;
      case "next":
      case "previous": {
        const next = adjacentChatSession(options.sessionIds ?? sessions.map((session) => session.id), chat.currentSession?.id, id);
        if (next) selectSession(next);
        return true;
      }
      case "scope": return click("[data-ai-chat-scope] button, [data-chat-board-selector] button");
      case "search":
        if (options.onSearch) options.onSearch();
        else {
          if (chat.sessionPagingEnabled) void chat.refreshHistorySessions();
          setPicker("search");
        }
        return true;
      case "focus":
        chat.restoreChat();
        focusComposer();
        return true;
      case "model": return click("[data-ai-chat-model] button");
      case "attach":
        chat.handleAttachmentClick();
        focusComposer();
        return true;
      case "mic": return click(chat.isRecording ? "[data-ai-chat-recording-submit]" : "[data-ai-chat-recorder]");
      case "mention":
        chat.restoreChat();
        chat.handleAddContext();
        return true;
      case "send": {
        const target = document.activeElement;
        if (!(target instanceof HTMLElement) || !target.closest("[data-ai-chat-composer]") || !target.closest(".ProseMirror[contenteditable='true']") || target.closest("[data-agent-chat-ai-composer]")) return false;
        if (chat.isRecording) return click("[data-ai-chat-recording-submit]");
        const event = currentEvent.current;
        if (!event) return false;
        chat.tiptapKeydown(event);
        return event.defaultPrevented;
      }
      case "stop":
        if (chat.isRecording) return click("[data-ai-chat-recording-cancel]");
        if (document.activeElement instanceof HTMLInputElement) return false;
        if (!chat.isTyping || document.getElementById(DIV_ID_CONSTANTS.aiMentionList) || document.getElementById(SLASH_MENU_DOM_ID) || root.querySelector("[aria-expanded='true']")) return false;
        chat.handleCancelStream();
        focusComposer();
        return true;
      case "pin":
        if (!chat.currentSession) return false;
        const sessionId = chat.currentSession.id;
        setPinnedIds((previous) => previous.includes(sessionId)
          ? previous.filter((value) => value !== sessionId)
          : [...previous, sessionId]);
        focusComposer();
        return true;
      case "delete":
        if (!chat.currentSession) return false;
        if (window.confirm("Delete this chat?")) void chat.deleteSession(chat.currentSession.id).then(focusComposer);
        else focusComposer();
        return true;
      case "help": setPicker("help"); return true;
    }
  };
  const onKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!enabled || event.nativeEvent.keyCode === 229) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-agent-chat-ai-composer]")) return;
    rootRef.current = event.currentTarget;
    currentEvent.current = event;
    dispatchChatShortcut(event.nativeEvent, {
      insideChat: target instanceof HTMLElement && target.closest("[data-ai-chat-surface]") === event.currentTarget,
      desktop: window.innerWidth >= 768,
      editable: target instanceof HTMLElement && Boolean(target.closest("input, textarea, [contenteditable='true']")),
      run,
    });
    if (event.nativeEvent.defaultPrevented) event.stopPropagation();
  };
  const modal = enabled && picker && <OptionPickerModal
    header={picker === "help" ? "Chat shortcuts" : "Search chats"}
    options={picker === "help"
      ? CHAT_SHORTCUTS.map((shortcut) => ({ id: shortcut.id, label: shortcut.label, hint: chatShortcutHint(shortcut.id, isApple) }))
      : sessions.map((session) => ({ id: session.id, label: session.title, checked: session.id === chat.currentSession?.id }))}
    onClose={closePicker}
    onLoadMore={picker === "search" && chat.sessionPagingEnabled && chat.hasMoreSessions ? () => { void chat.loadMoreSessions(); } : undefined}
    isLoadingMore={chat.isLoadingMoreSessions}
    onSelect={({ id }) => {
      closePicker();
      if (typeof id !== "string") return;
      if (picker === "search") selectSession(id);
    }}
  />;
  return { enabled, onKeyDownCapture, modal, surfaceRef: (element: HTMLElement | null) => { rootRef.current = element; } };
}
