"use client";

import { AI_Tiptap_Container } from "@/components/AI_CHAT/AI_Tiptap_Container";
import { MessageList } from "@/components/AI_CHAT/MessageList";
import { WelcomeScreen } from "@/components/AI_CHAT/WelcomeScreen";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import {
  buildFullScreenChatPath,
  FULL_SCREEN_CHAT_RETURN_PARAM,
  resolveFullScreenChatReturnPath,
} from "@/lib/aiChatDisplayMode";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { IChatSession, IProject, ITeam } from "@/models/model";
import {
  aiChatPinnedSessionIdsAtom,
  currentUserAtom,
  fullScreenChatRailWidthAtom,
  fullScreenChatScopeAtom,
  recentChatBoardIdsAtom,
} from "@/store";
import { sortBoardsByRecent } from "@/utils/aiChat/sortBoardsByRecent";
import { cn } from "@/utils/undoActions/helperFuncs";
import formatDateDifference from "@/utils/generateTime";
import {
  Check,
  ChevronDown,
  Minimize2,
  Pin,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FULL_SCREEN_CHAT_RAIL_MIN_PX = 200;
const FULL_SCREEN_CHAT_RAIL_MAX_PX = 480;

function clampFullScreenChatRailWidth(width: number) {
  return Math.max(
    FULL_SCREEN_CHAT_RAIL_MIN_PX,
    Math.min(FULL_SCREEN_CHAT_RAIL_MAX_PX, width)
  );
}

type SessionGroup = {
  title: "Today" | "Previous 7 days" | "Older";
  sessions: IChatSession[];
};

type FullScreenChatScope = number | null;

type ChatProps = {
  initialSessionId?: string;
};

function projectLabel(project: IProject) {
  return project.title ?? project.name;
}

function groupSessions(sessions: IChatSession[]): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const previousSevenDays = startOfToday - 7 * MS_PER_DAY;
  const groups: SessionGroup[] = [
    { title: "Today", sessions: [] },
    { title: "Previous 7 days", sessions: [] },
    { title: "Older", sessions: [] },
  ];

  sessions.forEach((session) => {
    const updatedAt = new Date(session.updatedAt).getTime();
    if (updatedAt >= startOfToday) {
      groups[0].sessions.push(session);
    } else if (updatedAt >= previousSevenDays) {
      groups[1].sessions.push(session);
    } else {
      groups[2].sessions.push(session);
    }
  });

  return groups.filter((group) => group.sessions.length > 0);
}

function FullScreenChatRailResizeHandle() {
  const [widthState, setWidthPx] = useRecoilState(fullScreenChatRailWidthAtom);
  const widthPx = widthState as number;
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(widthPx);
  widthRef.current = widthPx;

  useEffect(() => {
    const clampedWidth = clampFullScreenChatRailWidth(widthPx);
    if (clampedWidth !== widthPx) setWidthPx(clampedWidth);
  }, [setWidthPx, widthPx]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startWidth = widthRef.current;
    const startX = event.clientX;
    setIsDragging(true);
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setWidthPx(clampFullScreenChatRailWidth(nextWidth));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const accent = isDragging || isHovered;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={FULL_SCREEN_CHAT_RAIL_MIN_PX}
      aria-valuemax={FULL_SCREEN_CHAT_RAIL_MAX_PX}
      onPointerDown={onPointerDown}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => {
        if (!isDragging) setIsHovered(false);
      }}
      className={cn(
        "absolute inset-y-0 right-[-2px] z-[52] hidden w-1 cursor-col-resize md:block",
        isDragging && "select-none"
      )}
      data-dragging={isDragging || undefined}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
          !isDragging && "transition-colors duration-150",
          accent ? "bg-hypertasks-header-blue" : "bg-white/15"
        )}
      />
      <span
        className={cn(
          "border pointer-events-none absolute left-1/2 top-1/2 h-6 w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full",
          !isDragging && "transition-all duration-150",
          isDragging
            ? "scale-110 bg-hypertasks-header-blue"
            : isHovered
              ? "bg-[#666666]"
              : "border-white/20 bg-transparent"
        )}
      />
    </div>
  );
}

function FullScreenChatBoardSelector({
  sessions,
  scope,
  onScopeChange,
}: {
  sessions: IChatSession[];
  scope: FullScreenChatScope;
  onScopeChange: (scope: FullScreenChatScope) => void;
}) {
  const currentUser = useRecoilValue(currentUserAtom);
  const [recentChatBoardIds, setRecentChatBoardIds] = useRecoilState<number[]>(
    recentChatBoardIdsAtom
  );
  const { data: allTeams } = useGetAllTeamsMinimal(currentUser?.id ?? null);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const teams = useMemo(
    () =>
      sortBoardsByRecent(
        (allTeams ?? []) as ITeam[],
        recentChatBoardIds
      ),
    [allTeams, recentChatBoardIds]
  );
  const projectCounts = useMemo(() => {
    const counts = new Map<number, number>();
    sessions.forEach((session) => {
      if (
        session.projectId == null ||
        (session.messages?.length ?? 0) === 0
      ) {
        return;
      }
      counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
    });
    return counts;
  }, [sessions]);
  const selectedProject = teams
    .flatMap((team) => team.projects)
    .find((project) => project.id === scope);
  const selectedLabel = selectedProject
    ? projectLabel(selectedProject)
    : scope === null
      ? "All boards"
      : `Board ${scope}`;

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const selectScope = (nextScope: FullScreenChatScope) => {
    if (typeof nextScope === "number") {
      setRecentChatBoardIds((previousIds) =>
        [nextScope, ...previousIds.filter((id) => id !== nextScope)].slice(
          0,
          12
        )
      );
    }
    onScopeChange(nextScope);
    setIsOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 rounded bg-kanban-active-cardbg px-3 py-2 text-left text-content transition-colors hover:bg-hover-active"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-icon-dark-gray transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          strokeWidth={1.75}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-60 w-full overflow-y-auto rounded-md bg-modalBackground py-1 shadow-lg scrollbar-thin hover:scrollbar-thumb-gray-500 scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]"
        >
          <ChatRailFilterRow
            label="All boards"
            selected={scope === null}
            onClick={() => selectScope(null)}
          />
          {teams.map((team) => (
            <div key={team.id} className="pt-1">
              <div className="px-3 pb-1 pt-1 text-micro font-medium text-icon-dark-gray">
                {team.title}
              </div>
              {team.projects.map((project) => (
                <ChatRailFilterRow
                  key={project.id}
                  label={projectLabel(project)}
                  count={projectCounts.get(project.id) ?? 0}
                  selected={scope === project.id}
                  onClick={() => selectScope(project.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatRailFilterRow({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-dense text-white-black transition-colors hover:bg-active-modal-element"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!count && (
        <span className="ml-auto shrink-0 text-right text-micro tabular-nums text-icon-dark-gray">
          {count}
        </span>
      )}
      {selected && <Check size={16} className="shrink-0" strokeWidth={1.75} />}
    </button>
  );
}

export default function Chat({ initialSessionId }: ChatProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnPath = resolveFullScreenChatReturnPath(
    searchParams?.get(FULL_SCREEN_CHAT_RETURN_PARAM)
  );
  const hasSelectedInitialSession = useRef(false);
  const sessionsBeforeNewSession = useRef<Set<string> | null>(null);
  const [railWidthState] = useRecoilState(fullScreenChatRailWidthAtom);
  const [fullScreenChatScopeState, setFullScreenChatScope] = useRecoilState(
    fullScreenChatScopeAtom
  );
  const [aiChatPinnedSessionIds, setAiChatPinnedSessionIds] = useRecoilState(
    aiChatPinnedSessionIdsAtom
  );
  const fullScreenChatScope =
    typeof fullScreenChatScopeState === "number"
      ? fullScreenChatScopeState
      : null;
  const railWidthPx = railWidthState as number;
  const [searchQuery, setSearchQuery] = useState("");
  const {
    activeSession,
    deleteSession,
    selectSession,
    sessions,
    startNewSession,
    setChatMounted,
    setShowAIChat,
    setAiChatAutoOpenSuppressed,
    editor,
  } = useAiChatContext();
  const activeSessionId = activeSession ?? sessions[0]?.id ?? null;
  const currentSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0];

  useEffect(() => {
    if (
      hasSelectedInitialSession.current ||
      !initialSessionId ||
      sessions.length === 0
    ) {
      return;
    }

    hasSelectedInitialSession.current = true;
    selectSession(initialSessionId);
  }, [initialSessionId, selectSession, sessions.length]);

  useEffect(() => {
    const previousSessionIds = sessionsBeforeNewSession.current;
    if (!previousSessionIds || !activeSession) return;

    const newSession = sessions.find(
      (session) => !previousSessionIds.has(session.id)
    );
    if (!newSession || newSession.id !== activeSession) return;

    sessionsBeforeNewSession.current = null;
    router.replace(buildFullScreenChatPath(returnPath, newSession.id));
  }, [activeSession, returnPath, router, sessions]);

  useEffect(() => {
    if (fullScreenChatScopeState !== fullScreenChatScope) {
      setFullScreenChatScope(fullScreenChatScope);
    }
  }, [
    fullScreenChatScope,
    fullScreenChatScopeState,
    setFullScreenChatScope,
  ]);

  const { pinnedSessions, sessionGroups } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const visibleSessions = sessions
      .filter((session) => (session.messages?.length ?? 0) > 0)
      .filter((session) =>
        fullScreenChatScope === null
          ? true
          : session.projectId === fullScreenChatScope
      )
      .filter((session) => session.title.toLowerCase().includes(query))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    const pinnedSessionIds = new Set(aiChatPinnedSessionIds);

    return {
      pinnedSessions: visibleSessions.filter((session) =>
        pinnedSessionIds.has(session.id)
      ),
      sessionGroups: groupSessions(
        visibleSessions.filter((session) => !pinnedSessionIds.has(session.id))
      ),
    };
  }, [
    aiChatPinnedSessionIds,
    searchQuery,
    sessions,
    fullScreenChatScope,
  ]);
  const displayedSessionGroups = [
    ...(pinnedSessions.length > 0
      ? [{ title: "Pinned" as const, sessions: pinnedSessions }]
      : []),
    ...sessionGroups,
  ];
  const hasMessages = (sessions[0]?.messages?.length ?? 0) > 0;

  const handleStartNewSession = () => {
    sessionsBeforeNewSession.current = new Set(
      sessions.map((session) => session.id)
    );
    void startNewSession();
    // Cursor into the fresh composer; DOM focus, not the Tiptap command,
    // which can silently no-op (HTPR-4565).
    setTimeout(() => { try { editor?.view.dom.focus(); } catch { /* view unmounted */ } }, 0);
  };

  const handleTogglePinnedSession = (
    event: React.MouseEvent<HTMLButtonElement>,
    sessionId: string
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setAiChatPinnedSessionIds((pinnedSessionIds) =>
      pinnedSessionIds.includes(sessionId)
        ? pinnedSessionIds.filter((id) => id !== sessionId)
        : [...pinnedSessionIds, sessionId]
    );
  };

  const handleDeleteSession = (
    event: React.MouseEvent<HTMLButtonElement>,
    sessionId: string
  ) => {
    event.stopPropagation();
    event.preventDefault();
    if (window.confirm("Delete this chat?")) {
      void deleteSession(sessionId);
    }
  };

  const switchToDocked = () => {
    setChatMounted(true);
    setShowAIChat(true);
    setAiChatAutoOpenSuppressed(false);

    router.replace(returnPath);
  };

  return (
    <main className="flex h-SVH-full min-h-0 w-full overflow-hidden bg-ai-chat text-white-black">
      <aside
        className="relative hidden h-full shrink-0 flex-col border-r border-light-black-border-1 bg-modalBackground md:flex"
        style={{ width: clampFullScreenChatRailWidth(railWidthPx) }}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={handleStartNewSession}
            className="flex w-full items-center gap-2 rounded bg-kanban-active-cardbg px-3 py-2 text-left text-content transition-colors hover:bg-hover-active"
          >
            <SquarePen
              size={16}
              className="shrink-0 text-icon-dark-gray"
              strokeWidth={1.75}
            />
            <span>New chat</span>
          </button>
        </div>

        <div className="px-3 pb-3">
          <FullScreenChatBoardSelector
            sessions={sessions}
            scope={fullScreenChatScope}
            onScopeChange={setFullScreenChatScope}
          />
        </div>

        <div className="px-3 pb-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-icon-dark-gray"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full border-0 border-b border-light-black-border-1 bg-transparent py-2 pl-7 pr-2 text-content text-white-black outline-none placeholder:text-icon-dark-gray"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin hover:scrollbar-thumb-gray-500 scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar dark:scrollbar-thumb-[#4F5766]">
          {displayedSessionGroups.length === 0 ? (
            <p className="px-3 py-2 text-meta text-icon-dark-gray">
              {searchQuery ? "No chats found" : "No previous chats"}
            </p>
          ) : (
            displayedSessionGroups.map((group) => (
              <section key={group.title} className="mb-3">
                <h2 className="px-3 pb-1 pt-2 text-micro font-medium text-icon-dark-gray">
                  {group.title}
                </h2>
                <ul className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const isPinned = aiChatPinnedSessionIds.includes(
                      session.id
                    );
                    return (
                      <li key={session.id}>
                        <div
                          className={`group relative flex w-full items-center rounded transition-colors hover:bg-hover-active ${
                            isActive ? "bg-kanban-active-cardbg" : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              selectSession(session.id);
                              router.replace(
                                buildFullScreenChatPath(returnPath, session.id)
                              );
                            }}
                            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-content"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {session.title}
                            </span>
                            <span className="shrink-0 text-micro text-icon-dark-gray transition-opacity group-hover:opacity-[0]">
                              {formatDateDifference(session.updatedAt)}
                            </span>
                          </button>
                          <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-[0] transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                            <button
                              type="button"
                              aria-label={isPinned ? "Unpin chat" : "Pin chat"}
                              onClick={(event) =>
                                handleTogglePinnedSession(event, session.id)
                              }
                              className={cn(
                                "rounded p-1 text-icon-dark-gray transition-colors hover:bg-hover-active hover:text-white-black",
                                isPinned && "text-white-black"
                              )}
                            >
                              <Pin
                                size={16}
                                fill={isPinned ? "currentColor" : "none"}
                                strokeWidth={1.75}
                              />
                            </button>
                            <button
                              type="button"
                              aria-label="Delete chat"
                              onClick={(event) =>
                                handleDeleteSession(event, session.id)
                              }
                              className="rounded p-1 text-icon-dark-gray transition-colors hover:bg-hover-active hover:text-white-black"
                            >
                              <Trash2 size={16} strokeWidth={1.75} />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <FullScreenChatRailResizeHandle />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles
              size={14}
              className="shrink-0 text-hypertasks-ai-purple"
              strokeWidth={1.75}
            />
            <h1 className="truncate text-content font-medium">
              {currentSession?.title ?? "AI Chat"}
            </h1>
          </div>
          <button
            type="button"
            onClick={switchToDocked}
            aria-label="Exit full-screen AI chat"
            title="Exit full screen"
            className="rounded p-1 text-icon-dark-gray transition-colors hover:bg-hover-active hover:text-white-black"
          >
            <Minimize2 size={16} strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="mx-auto flex h-full w-full max-w-[800px] flex-col">
              {hasMessages ? <MessageList /> : <WelcomeScreen />}
            </div>
          </div>
          <div className="mx-auto w-full max-w-[800px] shrink-0">
            <AI_Tiptap_Container />
          </div>
        </div>
      </section>
    </main>
  );
}
