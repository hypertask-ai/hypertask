import { HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG } from "@/lib/flags/definitions/htpr-8988-chat-window-layout";
import { HTPR_8261_CHAT_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8261-chat-cleanup";
import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { AgentSidebarChatCommands } from "./AgentSidebarChatCommands";
import type { SidebarChatAgent, SidebarChatContext } from "@/app/agents/chat/agentChatTypes";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import {
  Bot,
  type LucideIcon,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  History,
  Loader2,
  Maximize2,
  Minus,
  PanelRight,
  PanelRightClose,
  Pencil,
  PictureInPicture2,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFlag } from "@/hooks/useFlag";
import { useAiChatOpenPreferences } from "@/hooks/General/useAiChatOpenPreferences";
import { AI_CHAT_AUTO_OPEN_DEFAULTS, AI_CHAT_AUTO_OPEN_KEYS } from "@/lib/aiChat/autoOpenPreferences";
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
  keepAiChatClosedAtom,
  showAIChatInterfaceAtom,
} from "@/store";

type HistorySession = Pick<IChatSession, "id" | "title" | "updatedAt" | "createdAt" | "agentId"> & { agentName?: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getSessionUpdatedTime(session: HistorySession): number {
  const t = new Date(session.updatedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function partitionSessionsByRecency(sessions: HistorySession[], withToday = false): {
  today: HistorySession[];
  previous7Days: HistorySession[];
  older: HistorySession[];
} {
  const cutoff = Date.now() - 7 * MS_PER_DAY;
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const today: HistorySession[] = [];
  const previous7Days: HistorySession[] = [];
  const older: HistorySession[] = [];
  for (const s of sessions) {
    const updated = getSessionUpdatedTime(s);
    (withToday && updated >= startOfToday ? today : updated >= cutoff ? previous7Days : older).push(s);
  }
  return { today, previous7Days, older };
}

function ActiveCheck({ className }: { className?: string }) {
  return <Check size={16} className={className} aria-hidden strokeWidth={1.75} />;
}

const MENU_ROW_CLASS = "flex h-[30px] w-full items-center gap-2 rounded-[4px] px-2 text-left text-content font-medium text-white-black transition-colors hover:bg-hover-active";
const RECENT_AGENT_COUNT = 3;

const latestAgentSessionTime = (agent: SidebarChatAgent): number =>
  Math.max(0, ...(agent.sessions ?? []).map((session) => {
    const time = new Date(session.updatedAt).getTime();
    return Number.isNaN(time) ? 0 : time;
  }));

const filterAgentsByQuery = (agents: SidebarChatAgent[], query: string): SidebarChatAgent[] => {
  const needle = query.trim().toLowerCase();
  return needle ? agents.filter((agent) => agent.displayName.toLowerCase().includes(needle)) : agents;
};

const visibleDropdownAgents = (agents: SidebarChatAgent[], query: string, showAll: boolean): SidebarChatAgent[] => {
  const sorted = [...agents].sort((a, b) => latestAgentSessionTime(b) - latestAgentSessionTime(a) || a.displayName.localeCompare(b.displayName));
  const matches = filterAgentsByQuery(sorted, query);
  return showAll || query.trim() ? matches : matches.slice(0, RECENT_AGENT_COUNT);
};


function MenuRow({ icon: Icon, label, onClick, checked }: { icon: LucideIcon; label: string; onClick: () => void; checked?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} className={MENU_ROW_CLASS} onClick={onClick}>
      <Icon size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checked && <ActiveCheck className="shrink-0 text-white-black" />}
    </button>
  );
}

function ChatSessionRow({
  chat,
  isActive,
  isRunning,
  onSelect,
  compact = false,
  children,
}: {
  chat: HistorySession;
  isActive: boolean;
  isRunning: boolean;
  onSelect: () => void;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={children ? "flex items-center" : undefined}>
      <button
        type="button"
        data-chat-session-id={chat.id}
        onClick={onSelect}
        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-content text-white-black hover:bg-active-modal-element transition-colors", children && "min-w-0 flex-1", compact && "h-[30px] rounded-[4px] px-2 py-0", compact && isActive && "bg-active-modal-element")}
      >
        <span className="min-w-0 flex-1 truncate font-normal">
          {chat.title}
        </span>
        {chat.agentName && <span className="max-w-24 truncate text-micro text-icon-dark-gray">{chat.agentName}</span>}
        {isRunning && <Loader2 size={16} className="shrink-0 animate-spin" role="status" aria-label="Chat running" />}
        {isActive && !compact && <ActiveCheck className="shrink-0 text-white-black" />}
      </button>
      {children}
    </li>
  );
}

export const ChatHeader = ({ sidebarChats, windowDrag = false, allowDocking = !windowDrag }: { sidebarChats?: SidebarChatContext; windowDrag?: boolean; allowDocking?: boolean } = {}) => {
  const sideBySide = useFlag(HTPR_8988_CHAT_WINDOW_LAYOUT_FLAG);
  const dockingAvailable = sideBySide ? allowDocking : !windowDrag;
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
  const isFullScreenChat = pathname?.startsWith("/chat") ?? false;
  const chatCleanup = useFlag(HTPR_8261_CHAT_CLEANUP_FLAG) && !isFullScreenChat;
  const sessionPagingEnabled = useFlag(HTPR_6971_CHAT_HISTORY_PAGING_FLAG);
  const phoneChatDelete = useFlag(HTPR_7575_PHONE_CHAT_DELETE_FLAG);
  const chatHeaderNameEnabled = useFlag(HTPR_7773_CHAT_HEADER_NAME_FLAG);
  const chatRunningEnabled = useFlag(HTPR_7764_CHAT_RUNNING_FLAG);
  const headerMenus = useFlag("htpr-8956-ai-chat-header-menus");
  const keepClosedSwitch = useFlag("htpr-7530-keep-ai-chat-closed");
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
    chatWindows: chatWindowControls,
  } = useAiChatContext();
  const sidebarTitle = sidebarChats?.target.kind === "ai"
    ? (chatHeaderNameEnabled && currentSession?.title) || "AI chat"
    : sidebarChats?.target.agent.displayName;
  const runningIndicator = chatRunningEnabled && sidebarChats?.target.kind !== "external-agent" && currentSession && runningSessionIds.includes(currentSession.id)
    ? <Loader2 size={16} className="shrink-0 animate-spin" role="status" aria-label="Chat running" />
    : null;
  const isMbl = useContext(MobileViewContext);
  const isApple = useDeviceContext();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isStartingNewSession, setIsStartingNewSession] = useState(false);
  const isStartingNewSessionRef = useRef(false);
  const [aiChatPinned, setAiChatPinned] = useRecoilState(aiChatPinnedAtom);
  const [keepAiChatClosedLegacy, setKeepAiChatClosedLegacy] = useRecoilState(keepAiChatClosedAtom);
  const openPrefs = useAiChatOpenPreferences();
  const keepAiChatClosed = openPrefs.enabled ? AI_CHAT_AUTO_OPEN_KEYS.every((key) => !openPrefs.values[key]) : keepAiChatClosedLegacy;
  const setKeepAiChatClosed = (closed: boolean) => {
    if (!openPrefs.enabled) setKeepAiChatClosedLegacy(closed);
    else AI_CHAT_AUTO_OPEN_KEYS.forEach((key) => openPrefs.setPreference(key, closed ? false : AI_CHAT_AUTO_OPEN_DEFAULTS[key]));
  };
  const [historyQuery, setHistoryQuery] = useState("");
  const [agentViewId, setAgentViewId] = useState<string | null>(null);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [agentOptionIndex, setAgentOptionIndex] = useState(-1);
  const agentViewRef = useRef<HTMLDivElement>(null);
  const hasAgentSessions = useFlag(HTPR_8048_AGENT_SESSIONS_FLAG);
  const agentsInDropdown = hasAgentSessions && headerMenus && !isMbl && !!sidebarChats;
  const [historyMaxHeight, setHistoryMaxHeight] = useState<number | undefined>(undefined);
  const headerRef = useRef<HTMLDivElement>(null);
  const [, setAiChatExplicitOpenAt] = useRecoilState(aiChatExplicitOpenAtAtom);
  const [, setShowAiChatInterface] = useRecoilState(showAIChatInterfaceAtom);
  const [, setAiChatAutoOpenSuppressed] = useRecoilState(
    aiChatAutoOpenSuppressedAtom
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chatHeight = headerRef.current?.parentElement?.clientHeight;
    setHistoryMaxHeight(isDropdownOpen && chatHeight ? Math.round(chatHeight * 0.75) : undefined);
    if (!isDropdownOpen) { setHistoryQuery(""); setAgentViewId(null); setShowAllAgents(false); setAgentOptionIndex(-1); }
  }, [isDropdownOpen]);
  useEffect(() => { setAgentOptionIndex(-1); }, [historyQuery, showAllAgents]);
  useEffect(() => {
    if (agentViewId) agentViewRef.current?.focus({ preventScroll: true });
  }, [agentViewId]);
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
  const { today, previous7Days, older } = useMemo(() => {
    const query = headerMenus ? historyQuery.trim().toLowerCase() : "";
    const matchesQuery = (session: HistorySession) => !query || `${session.title ?? ""} ${session.agentName ?? ""}`.toLowerCase().includes(query);
    const personal = ((sessionPagingEnabled ? historySessions : sessions) ?? []).filter((session) => !filterAgentSessions || !session.agentId).filter(matchesQuery);
    const agentChats: HistorySession[] = hasAgentSessions ? (sidebarChats?.agents ?? []).flatMap((agent) =>
      (agent.sessions ?? []).map((session) => ({ ...session, agentId: agent.id, agentName: agent.displayName }))).filter(matchesQuery) : [];
    return partitionSessionsByRecency(hasAgentSessions ? [...personal, ...agentChats].sort((a, b) => getSessionUpdatedTime(b) - getSessionUpdatedTime(a)) : personal, headerMenus);
  }, [sessions, historySessions, sessionPagingEnabled, filterAgentSessions, hasAgentSessions, sidebarChats?.agents, headerMenus, historyQuery]);

  const talkingAgent = agentsInDropdown && sidebarChats?.target.kind !== "ai" ? sidebarChats?.target.agent : undefined;
  const talkingAgentSessionId = sidebarChats?.target.kind === "native-agent" ? currentSession?.id : talkingAgent?.sessionId;
  const talkingAgentSessionTitle = talkingAgent
    ? sidebarChats?.agents.find((agent) => agent.id === talkingAgent.id)?.sessions?.find((session) => session.id === talkingAgentSessionId)?.title
    : undefined;

  const resolvedSessionId = hasAgentSessions && sidebarChats?.target.kind === "external-agent" ? sidebarChats.target.agent.sessionId : currentSession?.id;

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
      if (agentViewId) {
        setAgentViewId(null);
        return;
      }
      setIsDropdownOpen(false);
      setIsOverflowOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [isDropdownOpen, isOverflowOpen, agentViewId]);

  const handleStartNewSession = async () => {
    if (isStartingNewSessionRef.current) return;
    if (chatWindowControls) {
      const opened = await chatWindowControls.openNewChatWindow();
      if (!opened && chatWindowControls.atCapacity) toast("Close a chat window to open another chat.");
      return;
    }
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
            compact={headerMenus}
            onSelect={() => {
              setIsDropdownOpen(false);
              const agent = hasAgentSessions && chat.agentId ? sidebarChats?.agents.find((item) => item.id === chat.agentId) : undefined;
              if (agent && sidebarChats?.onSelectAgentSession) sidebarChats.onSelectAgentSession(agent, chat.id);
              else {
                sidebarChats?.onSelect({ kind: "ai" });
                if (!isFullScreenChat && chat.id !== resolvedSessionId && chatWindowControls) {
                  if (chatWindowControls.focusOpenSessionWindow(chat.id)) return;
                  if (chatWindowControls.atCapacity) {
                    toast("Close a chat window to open another chat.");
                    return;
                  }
                  if (chatWindowControls.openSessionWindow(chat.id)) return;
                }
                selectSession(chat.id);
              }
            }}
          >
            {phoneChatDelete && isMbl && !(hasAgentSessions && sidebarChats && chat.agentId) && (
              <button
                type="button"
                aria-label="Delete chat"
                onClick={() => handleDeleteSession(chat.id)}
                className={cn(MOBILE_TARGET, chatCleanup ? "rounded-[4px]" : "rounded", "p-1 text-icon-dark-gray transition-colors hover:bg-hover-active hover:text-white-black")}
              >
                <Trash2 size={16} strokeWidth={1.75} />
              </button>
            )}
          </ChatSessionRow>
        );
      }
      return rows;
    };
    const agentView = agentsInDropdown ? sidebarChats?.agents.find((agent) => agent.id === agentViewId) : undefined;
    const dropdownAgents = agentsInDropdown && !agentView ? visibleDropdownAgents(sidebarChats?.agents ?? [], historyQuery, showAllAgents) : [];
    const matchingAgentCount = agentsInDropdown ? filterAgentsByQuery(sidebarChats?.agents ?? [], historyQuery).length : 0;
    const totalAgentCount = sidebarChats?.agents.length ?? 0;
    const startAgentSession = () => {
      if (!agentView) return;
      setIsDropdownOpen(false);
      sidebarChats?.onStartAgentSession?.(agentView);
    };
    return (
      <div
        id="ai-chat-session-history"
        className={cn("absolute mt-2 w-64 max-w-[calc(100vw-1rem)] overflow-y-auto bg-modalBackground scrollbar-none z-popup", headerMenus ? "max-h-[75svh] rounded-[4px] p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]" : "max-h-[min(60svh,15rem)] rounded-md shadow-lg", alignmentClass)}
        style={headerMenus && historyMaxHeight ? { maxHeight: historyMaxHeight } : undefined}
        onScroll={(event) => {
          const menu = event.currentTarget;
          if (sessionPagingEnabled && hasMoreSessions && !isLoadingMoreSessions && menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 40) {
            void loadMoreSessions();
          }
        }}
        onKeyDown={(event) => {
          if (agentViewId || (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter")) return;
          const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-testid="ai-chat-agents-section"] button')];
          if (!options.length) return;
          if (event.key === "Enter") {
            if (agentOptionIndex < 0) return;
            event.preventDefault();
            options[Math.min(agentOptionIndex, options.length - 1)]?.click();
            return;
          }
          event.preventDefault();
          const next = Math.max(0, Math.min(options.length - 1, (agentOptionIndex < 0 ? -1 : agentOptionIndex) + (event.key === "ArrowDown" ? 1 : -1)));
          setAgentOptionIndex(next);
          options[next]?.scrollIntoView?.({ block: "nearest" });
        }}
      >
        {agentView && sidebarChats && (
          <div
            ref={agentViewRef}
            tabIndex={-1}
            data-testid="ai-chat-agent-view"
            className="outline-none"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setAgentViewId(null);
              }
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                startAgentSession();
              }
            }}
          >
            <button type="button" className={cn(MENU_ROW_CLASS, "font-semibold")} aria-label="Back to all chats" onClick={() => setAgentViewId(null)}>
              <ChevronLeft size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />
              <Bot size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{agentView.displayName}</span>
            </button>
            <button type="button" className={MENU_ROW_CLASS} onClick={startAgentSession}>
              <SquarePen size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />
              <span className="min-w-0 flex-1 truncate">New session</span>
              <kbd className="text-micro text-icon-dark-gray">Enter</kbd>
            </button>
            {(agentView.sessions ?? []).length > 0 && <div className="px-2 pb-1 pt-2 text-micro font-medium text-icon-dark-gray">Past sessions</div>}
            <ul>
              {sessionRows((agentView.sessions ?? []).map((session) => ({ ...session, agentId: agentView.id })))}
            </ul>
            {agentView.hasMoreSessions && (
              <button type="button" className={cn(MENU_ROW_CLASS, "text-icon-dark-gray")} onClick={() => sidebarChats.onLoadMoreAgentSessions?.(agentView)}>
                Show more
              </button>
            )}
          </div>
        )}
        {headerMenus && !agentView && (
          <div className="sticky top-0 z-10 -mx-1 -mt-1 bg-modalBackground px-1 pb-1 pt-1">
            <label className="flex h-[30px] items-center gap-2 rounded-[4px] bg-ai-tiptap px-2">
              <Search strokeWidth={1.75} size={13} className="shrink-0 text-text-light-gray" aria-hidden />
              <input autoFocus type="text" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats"
                className="min-w-0 flex-1 bg-transparent text-content text-white-black outline-none placeholder:text-text-light-gray" />
            </label>
          </div>
        )}
        {!agentView && dropdownAgents.length > 0 && (
          <div className="pt-1" data-testid="ai-chat-agents-section">
            <div className="px-2 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">Agents</div>
            <ul className="pb-1">
              {dropdownAgents.map((agent, index) => (
                <li key={agent.id}>
                  <button type="button" data-agent-id={agent.id} aria-selected={agentOptionIndex === index} className={cn(MENU_ROW_CLASS, agentOptionIndex === index && "bg-active-modal-element")} onMouseEnter={() => setAgentOptionIndex(index)} onClick={() => setAgentViewId(agent.id)}>
                    <Bot size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{agent.displayName}</span>
                    <ChevronRight size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />
                  </button>
                </li>
              ))}
              {!historyQuery.trim() && totalAgentCount > RECENT_AGENT_COUNT && (
                <li>
                  <button type="button" aria-expanded={showAllAgents} aria-selected={agentOptionIndex === dropdownAgents.length} className={cn(MENU_ROW_CLASS, "text-icon-dark-gray", agentOptionIndex === dropdownAgents.length && "bg-active-modal-element")} onMouseEnter={() => setAgentOptionIndex(dropdownAgents.length)} onClick={() => setShowAllAgents((open) => !open)}>
                    <span className="min-w-0 flex-1 truncate">{showAllAgents ? "Fewer agents" : `All ${totalAgentCount} agents`}</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
        {!agentView && sessionPagingEnabled && pagingError && (
          <p role="alert" className="px-3 py-2 text-content">
            Couldn’t load older chats. Scroll to try again.
          </p>
        )}
        {!agentView && today.length > 0 && (
          <div className="pt-1">
            <div className="px-2 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">Today</div>
            <ul className="pb-1">{sessionRows(today)}</ul>
          </div>
        )}
        {!agentView && previous7Days.length > 0 && (
          <div className="pt-1">
            <div className={cn("px-3 pb-1 pt-1 text-micro font-medium text-icon-dark-gray", headerMenus && "px-2")}>
              Previous 7 days
            </div>
            <ul className="pb-1">
              {sessionRows(previous7Days)}
            </ul>
          </div>
        )}
        {!headerMenus && previous7Days.length > 0 && older.length > 0 && (
          <div className="mx-2 h-px bg-gray-600/60" role="separator" />
        )}
        {!agentView && older.length > 0 && (
          <div className="pb-1">
            <div className={cn("px-3 pb-1 pt-2 text-micro font-medium text-icon-dark-gray", headerMenus && "px-2")}>
              Older
            </div>
            <ul>
              {sessionRows(older)}
            </ul>
          </div>
        )}
        {!agentView && hasAgentSessions && sidebarChats?.agents.some((agent) => agent.hasMoreSessions) && (
          <button type="button" className="w-full px-3 py-2 text-left text-content text-icon-dark-gray hover:bg-active-modal-element"
            onClick={() => sidebarChats.agents.filter((agent) => agent.hasMoreSessions).forEach((agent) => sidebarChats.onLoadMoreAgentSessions?.(agent))}>
            Show older agent sessions
          </button>
        )}
        {!agentView && headerMenus && historyQuery.trim() && !today.length && !previous7Days.length && !older.length && !matchingAgentCount && (
          <p className="px-2 py-2 text-content text-icon-dark-gray">No chats found</p>
        )}
        {!agentView && sessionPagingEnabled && hasMoreSessions && <div ref={historyEndRef} className="h-1" aria-hidden />}
      </div>
    );
  };

  const historyButton = (
    <button type="button" onMouseDown={sidebarChats ? (event) => event.stopPropagation() : undefined}
      onClick={() => { if (sidebarChats) { closeConversations(); closeAgents(); setIsOverflowOpen(false); } setIsDropdownOpen((open) => !open); }}
      aria-label="Chat history" aria-controls="ai-chat-session-history" aria-expanded={isDropdownOpen}
      className={isMbl
        ? `flex h-11 w-11 touch-manipulation items-center justify-center ${chatCleanup ? "rounded-[4px]" : "rounded-full"} text-icon-dark-gray hover:bg-hover-active hover:text-white-black`
        : "text-icon-dark-gray hover:text-white-black"}>
      <History size={isMbl ? 20 : 16} strokeWidth={1.75} />
    </button>
  );

  const agentsButton = !agentsInDropdown && (hasAgentSessions || (headerMenus && !isMbl && !!sidebarChats?.agents.length)) && sidebarChats ? (
    <div className="relative shrink-0">
      <button ref={agentButtonRef} type="button" aria-label="Agent sessions" aria-expanded={hasAgentSessions ? agentsOpen : conversationsOpen}
        aria-controls={hasAgentSessions ? "agent-sidebar-agents" : "agent-sidebar-conversations"}
        onClick={() => {
          setIsDropdownOpen(false);
          if (hasAgentSessions) { closeConversations(); setAgentsOpen((open) => !open); return; }
          setConversationsOpen((open) => !open);
        }}
        className={isMbl ? `flex h-11 w-11 touch-manipulation items-center justify-center ${chatCleanup ? "rounded-[4px]" : "rounded-full"} text-icon-dark-gray hover:bg-hover-active hover:text-white-black` : "block text-icon-dark-gray hover:text-white-black"}>
        <Bot size={isMbl ? 20 : 16} strokeWidth={1.75} />
      </button>
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
          className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center ${chatCleanup ? "rounded-[4px]" : "rounded-full"} text-icon-dark-gray hover:bg-hover-active hover:text-white-black`}
        >
          <ChevronDown size={22} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          {sidebarChats ? (
            <div className="relative">
              <button ref={titleRef} type="button" aria-label="Switch conversation" aria-expanded={conversationsOpen}
                aria-controls="agent-sidebar-conversations" onClick={() => { closeAgents(); setIsDropdownOpen(false); setConversationsOpen((open) => !open); }}
                className={cn(MOBILE_TARGET, chatCleanup && "rounded-[4px]", "max-w-full gap-1 truncate px-2 text-modalSmall font-semibold leading-5")}>
                <span className="truncate">{sidebarTitle}</span>{runningIndicator}<ChevronDown size={18} aria-hidden />
              </button>
              {conversationsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={titleRef} onClose={closeConversations} />}
              {hasAgentSessions && agentsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={agentButtonRef} onClose={closeAgents} agentsOnly />}
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
          className={`flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center ${chatCleanup ? "rounded-[4px]" : "rounded-full"} text-icon-dark-gray hover:bg-hover-active hover:text-white-black disabled:cursor-wait disabled:opacity-50`}
        >
          <SquarePen size={20} strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={headerRef}
      data-chat-window-drag={windowDrag ? "" : undefined}
      className={cn(
        "z-10 text-content px-2 gap-4 flex items-center justify-between text-white-black",
        !headerMenus && "font-bold",
        isSidebarMode ? "h-[48px] pt-4 pb-0" : "py-2"
      )}
    >
      <div className="relative min-w-0 flex-1" ref={dropdownRef}>
        <button
          type="button"
          ref={titleRef}
          title={sidebarTitle ?? currentSession?.title ?? undefined}
          aria-label={sidebarChats ? (headerMenus ? "Chat history" : "Switch conversation") : undefined}
          aria-expanded={sidebarChats && !headerMenus ? conversationsOpen : isDropdownOpen}
          aria-controls={sidebarChats && !headerMenus ? "agent-sidebar-conversations" : "ai-chat-session-history"}
          onClick={() => {
            if (sidebarChats && !headerMenus) { closeAgents(); setIsDropdownOpen(false); setConversationsOpen((open) => !open); }
            else {
              if (sidebarChats) { closeConversations(); closeAgents(); }
              setIsOverflowOpen(false);
              setIsDropdownOpen((prev) => !prev);
            }
          }}
          className={cn(
            "flex min-w-0 max-w-full items-center gap-1 transition-colors px-1 py-0.5",
            chatCleanup ? "rounded-[4px]" : "rounded",
            headerMenus ? "bg-ai-tiptap px-2 py-1 rounded-[4px] hover:bg-active-modal-element" : "hover:bg-active-modal-element",
            headerMenus && isDropdownOpen && "bg-active-modal-element"
          )}
        >
          {talkingAgent && <Bot size={16} className="shrink-0 text-icon-dark-gray" strokeWidth={1.75} aria-hidden />}
          <span className="min-w-0 truncate font-medium">
            {sidebarTitle ?? currentSession?.title ?? (isSessionPending && !quietTicketOpen ? "Loading..." : "AI Chat")}
          </span>
          {talkingAgentSessionTitle && <span className="min-w-0 truncate text-icon-dark-gray" data-testid="ai-chat-agent-session-title">{talkingAgentSessionTitle}</span>}
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
              className={cn("text-icon-dark-gray transition-transform", (sidebarChats && !headerMenus ? conversationsOpen : isDropdownOpen) && "rotate-180")}
              strokeWidth={1.75}
            />
          </span>
        </button>

        {sidebarChats && conversationsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={headerMenus ? agentButtonRef : titleRef} onClose={closeConversations} />}
        {hasAgentSessions && sidebarChats && agentsOpen && <AgentSidebarChatCommands context={sidebarChats} anchorRef={agentButtonRef} onClose={closeAgents} agentsOnly />}
        {renderSessionMenu("left-0")}
      </div>

      <div className="flex shrink-0 items-center space-x-2">
        {agentsButton}
        {sidebarChats && !headerMenus && historyButton}
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
            className="block text-icon-dark-gray hover:text-white-black relative group"
          >
            <Ellipsis size={16} strokeWidth={1.75} />
          </button>

          {isOverflowOpen && (
            <div
              role="menu"
              className={cn("absolute right-0 z-20", headerMenus ? "mt-1 w-[184px] rounded-[4px] bg-modalBackground p-1 shadow-[0_8px_30px_rgba(0,0,0,0.45)]" : "mt-1 w-40 overflow-hidden rounded-md bg-modalBackground shadow-lg")}
            >
              {headerMenus ? (
                <>
                  <MenuRow
                    icon={Pin}
                    label="Pin chat open"
                    checked={aiChatPinned}
                    onClick={() => {
                      setAiChatPinned(!aiChatPinned);
                      if (!aiChatPinned) {
                        if (keepAiChatClosed) setKeepAiChatClosed(false);
                        setAiChatExplicitOpenAt(Date.now());
                        setShowAiChatInterface(true);
                        setAiChatAutoOpenSuppressed(false);
                      }
                      setIsOverflowOpen(false);
                    }}
                  />
                  {keepClosedSwitch && (
                    <MenuRow
                      icon={PanelRightClose}
                      label="Keep chat closed"
                      checked={keepAiChatClosed}
                      onClick={() => {
                        const nextKeepClosed = !keepAiChatClosed;
                        setKeepAiChatClosed(nextKeepClosed);
                        setIsOverflowOpen(false);
                        if (!nextKeepClosed) return;
                        setAiChatPinned(false);
                        if (!isFullScreenChat) {
                          if (!isSidebarMode && !isMbl) minimizeChat();
                          else togglePopover();
                        }
                      }}
                    />
                  )}
                  {!isMbl && aiSessionActionsAvailable && dockingAvailable && (
                    <MenuRow
                      icon={isSidebarMode ? PictureInPicture2 : PanelRight}
                      label={isSidebarMode ? "Floating window" : "Sidebar"}
                      onClick={() => {
                        toggleSidebarMode();
                        setIsOverflowOpen(false);
                      }}
                    />
                  )}
                  {!isMbl && aiSessionActionsAvailable && (
                    <MenuRow
                      icon={Maximize2}
                      label="Full screen"
                      onClick={() => {
                        setIsOverflowOpen(false);
                        router.push(buildFullScreenChatPath(`${window.location.pathname}${window.location.search}${window.location.hash}`));
                      }}
                    />
                  )}
                  {aiSessionActionsAvailable && (
                    <MenuRow
                      icon={Pencil}
                      label="Rename chat"
                      onClick={() => {
                        toggleRenameChatModal();
                        setIsOverflowOpen(false);
                      }}
                    />
                  )}
                  {aiSessionActionsAvailable && (
                    <MenuRow
                      icon={Trash2}
                      label="Delete chat"
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
                    />
                  )}
                  {currentSession && aiSessionActionsAvailable && (
                    <>
                      <div className="mx-1 my-1 border-t border-border-light-gray-thin" role="separator" />
                      <div className="px-2 py-1 text-micro text-icon-dark-gray">
                        Created {format(new Date(currentSession.createdAt), "d MMM")}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
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
              {!isMbl && aiSessionActionsAvailable && dockingAvailable && (
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
