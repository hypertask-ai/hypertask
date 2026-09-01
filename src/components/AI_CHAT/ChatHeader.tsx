import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  History,
  Maximize2,
  Minus,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Tooltip from "../Common/Tooltip";
import { format } from "date-fns";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { buildFullScreenChatPath } from "@/lib/aiChatDisplayMode";
import { IChatSession } from "@/models/model";
import AIModelDropDownButton from "../Global/ModelSelectorDropdown";
import { useRecoilState } from "@/lib/state";
import toast from "react-hot-toast";
import {
  aiChatAutoOpenSuppressedAtom,
  aiChatPinnedAtom,
  showAIChatInterfaceAtom,
} from "@/store";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getSessionUpdatedTime(session: IChatSession): number {
  const t = new Date(session.updatedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function partitionSessionsByRecency(sessions: IChatSession[]): {
  previous7Days: IChatSession[];
  older: IChatSession[];
} {
  const cutoff = Date.now() - 7 * MS_PER_DAY;
  const previous7Days: IChatSession[] = [];
  const older: IChatSession[] = [];
  for (const s of sessions) {
    (getSessionUpdatedTime(s) >= cutoff ? previous7Days : older).push(s);
  }
  return { previous7Days, older };
}

function ChatSessionRow({
  chat,
  isActive,
  onSelect,
}: {
  chat: IChatSession;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
      >
        <span className="min-w-0 flex-1 truncate font-normal">
          {chat.title}
        </span>
        {isActive && (
          <Check
            size={16}
            className="shrink-0 text-white-black"
            aria-hidden
            strokeWidth={1.75}
          />
        )}
      </button>
    </li>
  );
}

export const ChatHeader = () => {
  const router = useRouter();
  const {
    togglePopover,
    minimizeChat,
    toggleSidebarMode,
    isSidebarMode,
    sessions,
    activeSession,
    startNewSession,
    selectSession,
    toggleRenameChatModal,
    deleteSession,
    editor,
    dropDownButtonAICallback,
    currentAiOption,
    displayAiOptions,
  } = useAiChatContext();
  const isMbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const isStartingNewSessionRef = useRef(false);
  const [aiChatPinned, setAiChatPinned] = useRecoilState(aiChatPinnedAtom);
  const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(
    aiChatAutoOpenSuppressedAtom
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  const { previous7Days, older } = useMemo(
    () => partitionSessionsByRecency(sessions ?? []),
    [sessions]
  );

  const activeSessionId = activeSession ?? sessions[0]?.id ?? null;
  const currentSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsDropdownOpen(false);
      }
      if (overflowRef.current && !overflowRef.current.contains(target)) {
        setIsOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleStartNewSession = async () => {
    if (isStartingNewSessionRef.current) return;
    isStartingNewSessionRef.current = true;
    setIsStartingNewSession(true);
    try {
      await startNewSession();
      setTimeout(() => {
        try {
          editor?.view.dom.focus();
        } catch {
          // The editor may have unmounted while the request completed.
        }
      }, 0);
    } catch {
      toast.error("Couldn't start a new chat. Please try again.");
    } finally {
      isStartingNewSessionRef.current = false;
      setIsStartingNewSession(false);
    }
  };

  const renderSessionMenu = (alignmentClass: string) =>
    isDropdownOpen ? (
      <div
        id="ai-chat-session-history"
        className={`absolute mt-2 max-h-[min(60svh,15rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md bg-modalBackground shadow-lg scrollbar-none z-[1200] ${alignmentClass}`}
      >
        {previous7Days.length > 0 && (
          <div className="pt-1">
            <div className="px-3 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">
              Previous 7 days
            </div>
            <ul className="pb-1">
              {previous7Days.map((chat: IChatSession) => (
                <ChatSessionRow
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeSessionId}
                  onSelect={() => {
                    setIsDropdownOpen(false);
                    selectSession(chat.id);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
        {previous7Days.length > 0 && older.length > 0 && (
          <div className="mx-2 h-px bg-gray-600/60" role="separator" />
        )}
        {older.length > 0 && (
          <div className="pb-1">
            <div className="px-3 pb-1 pt-2 text-micro font-medium text-icon-dark-gray">
              Older
            </div>
            <ul>
              {older.map((chat: IChatSession) => (
                <ChatSessionRow
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeSessionId}
                  onSelect={() => {
                    setIsDropdownOpen(false);
                    selectSession(chat.id);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    ) : null;

  if (isMbl) {
    return (
      <div
        data-ai-chat-mobile-header
        className="z-10 flex min-h-[68px] items-center gap-1 px-2 py-2 text-white-black"
      >
        <button
          type="button"
          onClick={togglePopover}
          aria-label="Close AI chat"
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:bg-hover-active hover:text-white-black"
        >
          <ChevronDown size={22} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <div
            className="truncate px-2 text-modalSmall font-semibold leading-5"
            title={currentSession?.title ?? undefined}
          >
            {currentSession?.title ?? "AI Chat"}
          </div>
          <AIModelDropDownButton
            optionCallback={dropDownButtonAICallback}
            aiSelected={currentAiOption}
            currentOptions={displayAiOptions}
            dropDownClassName="-my-2 min-h-11 px-2 py-2 text-text-light-gray"
            stackSubmenus
          />
        </div>
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsDropdownOpen((open) => !open)}
            aria-label="Chat history"
            aria-controls="ai-chat-session-history"
            aria-expanded={isDropdownOpen}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:bg-hover-active hover:text-white-black"
          >
            <History size={20} strokeWidth={1.75} />
          </button>
          {renderSessionMenu("right-0")}
        </div>
        <button
          type="button"
          onClick={handleStartNewSession}
          disabled={isStartingNewSession}
          aria-label="New chat"
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-50"
        >
          <SquarePen size={20} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    <div
      // Sidebar mode sits beside the board's title row, which is pt-4 over a
      // 32px row (centre 32px from the top). py-2 in a 48px box centred at 24px,
      // so the titles were 8px out of line: pt-4/pb-0 puts the centre at 32px.
      className={`z-10 text-content font-bold px-2 gap-4 flex items-center justify-between border-gray-700 text-white-black ${
        isSidebarMode ? "h-[48px] pt-4 pb-0" : "py-2"
      }`}
    >
      {/* min-w-0 is what actually lets the title truncate: a flex child refuses to shrink
          below its content width without it, so a long session title wrapped to three
          lines and spilled out of the fixed 48px header onto the messages (HTPR-4720). */}
      <div className="relative min-w-0 flex-1" ref={dropdownRef}>
        <button
          type="button"
          title={sessions[0]?.title ?? undefined}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          className="flex min-w-0 max-w-full items-center gap-1 hover:bg-active-modal-element transition-colors rounded px-1 py-0.5"
        >
          <span className="min-w-0 truncate font-medium">
            {sessions[0]?.title ?? "Loading..."}
          </span>
          <span
            style={{
              width: 18,
              height: 18,
              minWidth: 18,
              minHeight: 18,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronDown
              size={18}
              className={`text-icon-dark-gray transition-transform ${
                isDropdownOpen ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
            />
          </span>
        </button>

        {renderSessionMenu("left-0")}
      </div>

      {/* right side */}
      <div className="flex shrink-0 items-center space-x-2">
        <button
          onClick={handleStartNewSession}
          disabled={isStartingNewSession}
          className="text-icon-dark-gray hover:text-white-black relative group disabled:cursor-wait disabled:opacity-50"
        >
          <SquarePen size={16} strokeWidth={1.75} />
          <Tooltip
            {...(aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.new_chat_button(
              isApple
            ) as any)}
          />
        </button>
        <div className="relative place-items-center" ref={overflowRef}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOverflowOpen}
            onClick={() => setIsOverflowOpen((prev) => !prev)}
            className="text-icon-dark-gray hover:text-white-black relative group"
          >
            <Ellipsis size={16} strokeWidth={1.75} />
          </button>

          {isOverflowOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-1 w-40 overflow-hidden bg-modalBackground rounded-md shadow-lg z-20"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                onClick={() => {
                  const nextPinned = !aiChatPinned;
                  setAiChatPinned(nextPinned);
                  if (nextPinned) {
                    setShowAiChatInterface(true);
                    setAiChatAutoOpenSuppressed(false);
                  }
                  setIsOverflowOpen(false);
                }}
              >
                {aiChatPinned ? (
                  <PinOff size={14} className="shrink-0" strokeWidth={1.75} />
                ) : (
                  <Pin size={14} className="shrink-0" strokeWidth={1.75} />
                )}
                <span>{aiChatPinned ? "Unpin AI chat" : "Pin AI chat open"}</span>
              </button>
              {!isMbl && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                  onClick={() => {
                    toggleSidebarMode();
                    setIsOverflowOpen(false);
                  }}
                >
                  {!isSidebarMode ? (
                    <PanelRight
                      size={14}
                      className="shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <PictureInPicture2
                      size={14}
                      className="shrink-0"
                      strokeWidth={1.75}
                    />
                  )}
                  <span>
                    {
                      aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.toggle_sidebar_button(
                        isSidebarMode
                      ).text
                    }
                  </span>
                </button>
              )}
              {!isMbl && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                  onClick={() => {
                    setIsOverflowOpen(false);
                    router.push(
                      buildFullScreenChatPath(
                        `${window.location.pathname}${window.location.search}${window.location.hash}`
                      )
                    );
                  }}
                >
                  <Maximize2 size={14} className="shrink-0" strokeWidth={1.75} />
                  <span>Open full screen</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                onClick={() => {
                  toggleRenameChatModal();
                  setIsOverflowOpen(false);
                }}
              >
                <Pencil size={14} className="shrink-0" strokeWidth={1.75} />
                <span>
                  {
                    aiTaskWriterConfig.shortcutsAndTooltips.ai_chat
                      .rename_chat_button.text
                  }
                </span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                onClick={() => {
                  if (activeSessionId) {
                    void deleteSession(activeSessionId);
                  }
                  setIsOverflowOpen(false);
                }}
              >
                <Trash2 size={14} className="shrink-0" strokeWidth={1.75} />
                <span>
                  {
                    aiTaskWriterConfig.shortcutsAndTooltips.ai_chat
                      .delete_chat_button.text
                  }
                </span>
              </button>

              {currentSession && (
                <>
                  <div className="mx-2 h-px bg-gray-600/60" role="separator" />
                  <div className="px-3 py-2 text-micro text-icon-dark-gray">
                    Created{" "}
                    {format(new Date(currentSession.createdAt), "MMM d, yyyy")}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() =>
            !isSidebarMode && !isMbl ? minimizeChat() : togglePopover()
          }
          aria-label={isMbl ? "Close AI chat" : undefined}
          className="text-icon-dark-gray hover:text-white-black relative group"
        >
          {isSidebarMode && !isMbl ? (
            <ChevronRight size={16} strokeWidth={1.75} />
          ) : isMbl ? (
            // On mobile this fully closes the chat, so show a close affordance —
            // a minus reads as "minimize" and left the exit ambiguous.
            <X size={18} strokeWidth={1.75} />
          ) : (
            <Minus size={16} strokeWidth={1.75} />
          )}

          <Tooltip
            {...aiTaskWriterConfig.shortcutsAndTooltips.ai_chat.minimize_button(
              isApple
            )}
          />
        </button>
      </div>
    </div>
  );
};
