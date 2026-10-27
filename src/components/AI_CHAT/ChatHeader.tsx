import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { AgentSidebarChatCommands } from "./AgentSidebarChatCommands";
import type { SidebarChatContext } from "@/app/agents/chat/agentChatTypes";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  History,
  Loader2,
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6971_CHAT_HISTORY_PAGING_FLAG } from "@/lib/flags/keys";
import { HTPR_7575_PHONE_CHAT_DELETE_FLAG } from "@/lib/flags/definitions/htpr-7575-phone-chat-delete";
import { HTPR_7773_CHAT_HEADER_NAME_FLAG } from "@/lib/flags/definitions/htpr-7773-chat-header-name";
import { HTPR_7764_CHAT_RUNNING_FLAG } from "@/lib/flags/definitions/htpr-7764-chat-running";
import Tooltip from "../Common/Tooltip";
import { format } from "date-fns";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import { buildFullScreenChatPath } from "@/lib/aiChatDisplayMode";
import { IChatSession } from "@/models/model";
import { getMobileAiChatModelLabel } from "@/lib/aiModelOptions";
import { useRecoilState } from "@/lib/state";
import toast from "react-hot-toast";
import {
  aiChatAutoOpenSuppressedAtom,
  aiChatExplicitOpenAtAtom,
  aiChatPinnedAtom,
  showAIChatInterfaceAtom,
} from "@/store";

type HistorySession = Pick<IChatSession, "id" | "title" | "updatedAt" | "createdAt" | "agentId"> & { agentName?: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getSessionUpdatedTime(session: HistorySession): number {
  const t = new Date(session.updatedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function partitionSessionsByRecency(sessions: HistorySession[]): {
  previous7Days: HistorySession[];
  older: HistorySession[];
} {
  const cutoff = Date.now() - 7 * MS_PER_DAY;
  const previous7Days: HistorySession[] = [];
  const older: HistorySession[] = [];
  for (const s of sessions) {
    (getSessionUpdatedTime(s) >= cutoff ? previous7Days : older).push(s);
  }
  return { previous7Days, older };
}

function ChatSessionRow({
  chat,
  isActive,
  isRunning,
  onSelect,
  children,
}: {
  chat: HistorySession;
  isActive: boolean;
  isRunning: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <li className={children ? "flex items-center" : undefined}>
      <button
        type="button"
        data-chat-session-id={chat.id}
        onClick={onSelect}
        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors", children && "min-w-0 flex-1")}
      >
        <span className="min-w-0 flex-1 truncate font-normal">
          {chat.title}
        </span>
        {chat.agentName && <span className="max-w-24 truncate text-micro text-icon-dark-gray">{chat.agentName}</span>}
        {isRunning && <Loader2 size={16} className="shrink-0 animate-spin" role="status" aria-label="Chat running" />}
        {isActive && (
          <Check
            size={16}
            className="shrink-0 text-white-black"
            aria-hidden
            strokeWidth={1.75}
          />
        )}
      </button>
      {children}
    </li>
  );
}

export const ChatHeader = ({ sidebarChats }: { sidebarChats?: SidebarChatContext } = {}) => {
  const agentSessionsEnabled = useFlag(HTPR_8048_AGENT_SESSIONS_FLAG);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const agentButtonRef = useRef<HTMLButtonElement>(null);
  const closeAgents = useCallback(() => setAgentsOpen(false), []);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const closeConversations = useCallback(() => setConversationsOpen(false), []);
  const aiSessionActionsAvailable = !sidebarChats || sidebarChats.target.kind === "ai";
  useEffect(() => { setConversationsOpen(false); setAgentsOpen(false); }, [sidebarChats?.projectId]);
  const searchParams = useSearchParams();
  const openFromLink = searchParams?.get("agentSidebar");
  useEffect(() => {
    if (!sidebarChats) return;
    const open = () => setConversationsOpen(true);
    if (openFromLink && !searchParams?.get("sidebarAgent")) open();
    window.addEventListener("ht-agent-sidebar-open", open);
    return () => window.removeEventListener("ht-agent-sidebar-open", open);
  }, [!!sidebarChats, openFromLink]);
  const router = useRouter();
  const pathname = usePathname();
  const sessionPagingEnabled = useFlag(HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  const phoneChatDelete = useFlag(HTPR_7575_PHONE_CHAT_DELETE_FLAG);
  const chatHeaderNameEnabled = useFlag(HTPR_7773_CHAT_HEADER_NAME_FLAG);
  const chatRunningEnabled = useFlag(HTPR_7764_CHAT_RUNNING_FLAG);
  const quietTicketOpen = pathname?.startsWith("/detail/");
  const {
    togglePopover,
    minimizeChat,
    toggleSidebarMode,
    isSidebarMode,
    sessions, historySessions, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions, refreshHistorySessions,
    currentSession,
    runningSessionIds,
    isSessionPending,
    startNewSession,
    selectSession,
    toggleRenameChatModal,
    deleteSession,
    editor,
    currentAiOption,
  } = useAiChatContext();
  const sidebarTitle = sidebarChats?.target.kind === "ai"
    ? (chatHeaderNameEnabled && currentSession?.title) || "AI chat"
    : sidebarChats?.target.agent.displayName;
  const runningIndicator = chatRunningEnabled && aiSessionActionsAvailable && currentSession && runningSessionIds.includes(currentSession.id)
    ? <Loader2 size={16} className="shrink-0 animate-spin" role="status" aria-label="Chat running" />
    : null;
  const isMbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const isStartingNewSessionRef = useRef(false);
  const [aiChatPinned, setAiChatPinned] = useRecoilState(aiChatPinnedAtom);
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(
    aiChatAutoOpenSuppressedAtom
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sessionPagingEnabled && isDropdownOpen) {
      void refreshHistorySessions();
    }
  }, [sessionPagingEnabled, isDropdownOpen, refreshHistorySessions]);
  useEffect(() => {
    if (!sessionPagingEnabled || !isDropdownOpen || !hasMoreSessions || isLoadingMoreSessions || pagingError || !historyEndRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreSessions();
    }, { root: historyEndRef.current.parentElement });
    observer.observe(historyEndRef.current);
    return () => observer.disconnect();
  }, [sessionPagingEnabled, isDropdownOpen, hasMoreSessions, isLoadingMoreSessions, pagingError, loadMoreSessions]);

  const filterAgentSessions = Boolean(sidebarChats);
  const { previous7Days, older } = useMemo(() => {
    const personal = ((sessionPagingEnabled ? historySessions : sessions) ?? []).filter((session) => !filterAgentSessions || !session.agentId);
    const agentChats: HistorySession[] = agentSessionsEnabled ? (sidebarChats?.agents ?? []).flatMap((agent) =>
      (agent.sessions ?? []).map((session) => ({ ...session, agentId: agent.id, agentName: agent.displayName }))) : [];
    return partitionSessionsByRecency(agentSessionsEnabled ? [...personal, ...agentChats].sort((a, b) => getSessionUpdatedTime(b) - getSessionUpdatedTime(a)) : personal);
  }, [sessions, historySessions, sessionPagingEnabled, filterAgentSessions, agentSessionsEnabled, sidebarChats?.agents]);

  const resolvedSessionId = agentSessionsEnabled && sidebarChats?.target.kind === "external-agent" ? sidebarChats.target.agent.sessionId : currentSession?.id;

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

  useEffect(() => {
    if (!isDropdownOpen && !isOverflowOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setIsDropdownOpen(false);
      setIsOverflowOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [isDropdownOpen, isOverflowOpen]);

  const handleStartNewSession = async () => {
    if (isStartingNewSessionRef.current) return;
    isStartingNewSessionRef.current = true;
    setIsStartingNewSession(true);
    try {
      sidebarChats?.onSelect({ kind: "ai" });
      await startNewSession();
      setTimeout(() => {
        try {
          editor?.view.dom.focus();
        } catch {
        }
      }, 0);
    } catch {
      toast.error("Couldn't start a new chat. Please try again.");
    } finally {
      isStartingNewSessionRef.current = false;
      setIsStartingNewSession(false);
    }
  };

  const handleDeleteSession = (sessionId: string) => {
    if (window.confirm("Delete this chat?")) {
      void deleteSession(sessionId);
    }
  };

  const renderSessionMenu = (alignmentClass: string) => {
    if (!isDropdownOpen) return null;
    const sessionRows = (chats: HistorySession[]) => {
      const rows: ReactNode[] = [];
      for (const chat of chats) {
        rows.push(
          <ChatSessionRow
            key={chat.id}
            chat={chat}
            isActive={chat.id === resolvedSessionId}
            isRunning={chatRunningEnabled && runningSessionIds.includes(chat.id)}
            onSelect={() => {
              setIsDropdownOpen(false);
              const agent = agentSessionsEnabled && chat.agentId ? sidebarChats?.agents.find((item) => item.id === chat.agentId) : undefined;
              if (agent && sidebarChats?.onSelectAgentSession) sidebarChats.onSelectAgentSession(agent, chat.id);
              else {
                sidebarChats?.onSelect({ kind: "ai" });
                selectSession(chat.id);
              }
            }}
          >
            {phoneChatDelete && isMbl && !(agentSessionsEnabled && sidebarChats && chat.agentId) && (
              <button
                type="button"
                aria-label="Delete chat"
                onClick={() => handleDeleteSession(chat.id)}
                className={cn(MOBILE_TARGET, "rounded p-1 text-icon-dark-gray transition-colors hover:bg-hover-active hover:text-white-black")}
              >
                <Trash2 size={16} strokeWidth={1.75} />
              </button>
            )}
          </ChatSessionRow>
        );
      }
      return rows;
    };
    return (
      <div
        id="ai-chat-session-history"
        className={`absolute mt-2 max-h-[min(60svh,15rem)] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md bg-modalBackground shadow-lg scrollbar-none z-[1200] ${alignmentClass}`}
        onScroll={(event) => {
          const menu = event.currentTarget;
          if (sessionPagingEnabled && hasMoreSessions && !isLoadingMoreSessions && menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 40) {
            void loadMoreSessions();
          }
        }}
      >
        {sessionPagingEnabled && pagingError && (
          <p role="alert" className="px-3 py-2 text-content">
            Couldn’t load older chats. Scroll to try again.
          </p>
        )}
        {previous7Days.length > 0 && (
          <div className="pt-1">
            <div className="px-3 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">
              Previous 7 days
            </div>
            <ul className="pb-1">
              {sessionRows(previous7Days)}
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
              {sessionRows(older)}
            </ul>
          </div>
        )}
        {agentSessionsEnabled && sidebarChats?.agents.some((agent) => agent.hasMoreSessions) && (
          <button type="button" className="w-full px-3 py-2 text-left text-content text-icon-dark-gray hover:bg-active-modal-element"
            onClick={() => sidebarChats.agents.filter((agent) => agent.hasMoreSessions).forEach((agent) => sidebarChats.onLoadMoreAgentSessions?.(agent))}>
            Show older agent sessions
          </button>
        )}
        {sessionPagingEnabled && hasMoreSessions && <div ref={historyEndRef} className="h-1" aria-hidden />}
      </div>
    );
  };

  const historyButton = (
    <button type="button" onMouseDown={sidebarChats ? (event) => event.stopPropagation() : undefined}
      onClick={() => { if (sidebarChats) { closeConversations(); closeAgents(); setIsOverflowOpen(false); } setIsDropdownOpen((open) => !open); }}
      aria-label="Chat history" aria-controls="ai-chat-session-history" aria-expanded={isDropdownOpen}
      className={isMbl
        ? "flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:bg-hover-active hover:text-white-black"
        : "text-icon-dark-gray hover:text-white-black"}>
      <History size={isMbl ? 20 : 16} strokeWidth={1.75} />
    </button>
  );

  const agentsButton = agentSessionsEnabled && sidebarChats ? (
    <div className="relative shrink-0">
      <button ref={agentButtonRef} type="button" aria-label="Agent sessions" aria-expanded={agentsOpen}
        aria-controls="agent-sidebar-agents" onClick={() => { closeConversations(); setIsDropdownOpen(false); setAgentsOpen((open) => !open); }}
        className={isMbl ? "flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-icon-dark-gray hover:bg-hover-active hover:text-white-black" : "text-icon-dark-gray hover:text-white-black"}>
        <Bot size={isMbl ? 20 : 16} strokeWidth={1.75} />
      </button>
      {agentsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={agentButtonRef} onClose={closeAgents} agentsOnly />}
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
          {sidebarChats ? (
            <div className="relative">
              <button ref={titleRef} type="button" aria-label="Switch conversation" aria-expanded={conversationsOpen}
                aria-controls="agent-sidebar-conversations" onClick={() => { setIsDropdownOpen(false); setConversationsOpen((open) => !open); }}
                className={cn(MOBILE_TARGET, "max-w-full gap-1 truncate px-2 text-modalSmall font-semibold leading-5")}>
                <span className="truncate">{sidebarTitle}</span>{runningIndicator}<ChevronDown size={18} aria-hidden />
              </button>
              {conversationsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={titleRef} onClose={closeConversations} />}
            </div>
          ) : (
          <div
            className="flex items-center gap-1 truncate px-2 text-modalSmall font-semibold leading-5"
            title={currentSession?.title ?? undefined}
          >
            <span className="truncate">{currentSession?.title ?? "AI Chat"}</span>
            {runningIndicator}
          </div>
          )}
          {(!sidebarChats || sidebarChats.target.kind === "ai") && <div
            data-ai-chat-mobile-model-label
            className="flex min-h-6 items-center gap-1 px-2 text-dense text-text-light-gray"
          >
            <span className="truncate">
              {getMobileAiChatModelLabel(currentAiOption)}
            </span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
          </div>}
        </div>
        {agentsButton}
        <div className="relative shrink-0" ref={dropdownRef}>
          {historyButton}
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
      className={`z-10 text-content font-bold px-2 gap-4 flex items-center justify-between border-gray-700 text-white-black ${
        isSidebarMode ? "h-[48px] pt-4 pb-0" : "py-2"
      }`}
    >
      <div className="relative min-w-0 flex-1" ref={dropdownRef}>
        <button
          type="button"
          ref={titleRef}
          title={sidebarTitle ?? currentSession?.title ?? undefined}
          aria-label={sidebarChats ? "Switch conversation" : undefined}
          aria-expanded={sidebarChats ? conversationsOpen : isDropdownOpen}
          aria-controls={sidebarChats ? "agent-sidebar-conversations" : "ai-chat-session-history"}
          onClick={() => {
            if (sidebarChats) { setIsDropdownOpen(false); setConversationsOpen((open) => !open); }
            else setIsDropdownOpen((prev) => !prev);
          }}
          className="flex min-w-0 max-w-full items-center gap-1 hover:bg-active-modal-element transition-colors rounded px-1 py-0.5"
        >
          <span className="min-w-0 truncate font-medium">
            {sidebarTitle ?? currentSession?.title ?? (isSessionPending && !quietTicketOpen ? "Loading..." : "AI Chat")}
          </span>
          {runningIndicator}
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
                (sidebarChats ? conversationsOpen : isDropdownOpen) ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
            />
          </span>
        </button>

        {sidebarChats && conversationsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={titleRef} onClose={closeConversations} />}
        {renderSessionMenu("left-0")}
      </div>

      <div className="flex shrink-0 items-center space-x-2">
        {agentsButton}
        {sidebarChats && historyButton}
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
                    setAiChatExplicitOpenAt(Date.now());
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
              {!isMbl && aiSessionActionsAvailable && (
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
              {!isMbl && aiSessionActionsAvailable && (
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
              {aiSessionActionsAvailable && <button
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
              </button>}
              {aiSessionActionsAvailable && <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors"
                onClick={async () => {
                  setIsOverflowOpen(false);
                  if (!resolvedSessionId) {
                    toast.error("No chat selected yet. Please try again in a moment.");
                    return;
                  }
                  try {
                    await deleteSession(resolvedSessionId);
                  } catch {
                    toast.error("Couldn't delete this chat. Please try again.");
                  }
                }}
              >
                <Trash2 size={14} className="shrink-0" strokeWidth={1.75} />
                <span>
                  {
                    aiTaskWriterConfig.shortcutsAndTooltips.ai_chat
                      .delete_chat_button.text
                  }
                </span>
              </button>}

              {currentSession && aiSessionActionsAvailable && (
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
          aria-label={isMbl || sidebarChats ? "Close AI chat" : undefined}
          className="text-icon-dark-gray hover:text-white-black relative group"
        >
          {isSidebarMode && !isMbl ? (
            <ChevronRight size={16} strokeWidth={1.75} />
          ) : isMbl ? (
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
