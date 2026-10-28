"use client";

import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import CommandList from "@/components/Modals/commands/HTC/CommandList";
import { findCommandPosition } from "@/components/Modals/commands/HTC/commandSelection";
import type { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { CommandMode } from "@/models/enums";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7688_PAST_CHATS_FIRST_FLAG } from "@/lib/flags/definitions/htpr-7688-past-chats-first";
import { HTPR_7702_PHONE_CHAT_LIST_FLAG } from "@/lib/flags/definitions/htpr-7702-phone-chat-list";
import { useAiChatContext } from "@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context";
import type { SidebarChatContext } from "@/app/agents/chat/agentChatTypes";

export function AgentSidebarChatCommands({ context, anchorRef, onClose, agentsOnly = false }: {
  context: SidebarChatContext;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  agentsOnly?: boolean;
}) {
  const isMobile = useContext(MobileViewContext);
  const hostRef = useRef<HTMLUListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState(context.target.kind === "ai" ? "ai" : context.target.agent.id);
  const pastChatsFirst = useFlag(HTPR_7688_PAST_CHATS_FIRST_FLAG);
  const phoneChatList = useFlag(HTPR_7702_PHONE_CHAT_LIST_FLAG);
  const { sessions, historySessions, sessionPagingEnabled, hasMoreSessions, isLoadingMoreSessions, loadMoreSessions, refreshHistorySessions } = useAiChatContext();
  const [expanded, setExpanded] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const personalSessions = pastChatsFirst
    ? [...((sessionPagingEnabled ? historySessions : sessions) ?? [])]
      .filter((session) => !session.agentId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    : [];
  const visibleSessions = expanded ? personalSessions : personalSessions.slice(0, 5);
  const hiddenCount = personalSessions.length - visibleSessions.length;
  const commands = useMemo<ICommandList[]>(() => agentsOnly ? context.agents.flatMap((agent) => [
    { key: agent.id, name: agent.displayName, commandMode: CommandMode.GoToAgentChat },
    ...(expandedAgentId === agent.id ? [
      { key: `new:${agent.id}`, name: "Start a new session", commandMode: CommandMode.GoToAgentChat },
      ...(agent.sessions ?? []).map((session) => ({ key: `agent-session:${session.id}`, name: session.title, payload: agent.id, commandMode: CommandMode.GoToAgentChat })),
      ...(agent.hasMoreSessions ? [{ key: `more-agent:${agent.id}`, name: "Show more", payload: agent.id, commandMode: CommandMode.GoToAgentChat }] : []),
    ] : []),
  ]) : [
    { key: "ai", name: "AI chat", commandMode: CommandMode.GoToAgentChat },
    ...visibleSessions.map((session) => ({
      key: `session:${session.id}`, name: session.title, payload: session.id, commandMode: CommandMode.GoToAgentChat,
    })),
    ...(pastChatsFirst && (hiddenCount > 0 || hasMoreSessions) ? [{
      key: "more", name: hiddenCount > 0 ? `Show ${hiddenCount} more` : "Show more", commandMode: CommandMode.GoToAgentChat,
    }] : []),
    ...context.agents.map((agent) => ({
      key: agent.id,
      name: pastChatsFirst
        ? `${agent.displayName}${agent.status === "working" ? " · working" : ""}${agent.deliveryMode ? ` · ${agent.deliveryMode}` : ""}`
        : `${agent.displayName} · ${agent.status}${agent.deliveryMode ? ` · ${agent.deliveryMode}` : ""}`,
      commandMode: CommandMode.GoToAgentChat,
    })),
    ...(context.error ? [{ key: "retry", name: `${context.error}. Retry`, commandMode: CommandMode.GoToAgentChat }] : []),
  ], [context.agents, context.error, pastChatsFirst, visibleSessions, hiddenCount, hasMoreSessions, agentsOnly, expandedAgentId]);
  const groups = [{ group: "Conversations", commandLists: commands }];
  const selected = commands.find((command) => command.key === selectedKey) ?? commands[0];
  const choose = (command: ICommandList) => {
    if (agentsOnly) {
      const agent = context.agents.find((item) => item.id === command.key || item.id === command.payload || `new:${item.id}` === command.key);
      if (!agent) return;
      if (command.key.startsWith("more-agent:")) {
        context.onLoadMoreAgentSessions?.(agent);
        return;
      }
      if (command.key === agent.id) {
        setExpandedAgentId((previous) => previous === agent.id ? null : agent.id);
        return;
      }
      if (command.key.startsWith("new:")) context.onStartAgentSession?.(agent);
      else context.onSelectAgentSession?.(agent, command.key.slice("agent-session:".length));
      onClose();
      anchorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (command.key === "more") {
      setExpanded(true);
      if (!hiddenCount && hasMoreSessions && !isLoadingMoreSessions) void loadMoreSessions();
      return;
    }
    if (command.key.startsWith("session:") && command.payload) {
      context.onSelectSession(command.payload);
      onClose();
      anchorRef.current?.focus({ preventScroll: true });
      return;
    }
    if (command.key === "retry") return context.onRetry();
    const agent = context.agents.find((item) => item.id === command.key);
    context.onSelect(agent ? { kind: agent.runtimeType === "EXTERNAL" ? "external-agent" : "native-agent", agent } : { kind: "ai" });
    onClose();
    anchorRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const host = hostRef.current;
    const anchor = anchorRef.current;
    if (!host || !anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      let maxHeight = window.innerHeight - box.bottom - 12;
      if (isMobile && phoneChatList) {
        const composers = host.closest('[data-testid="ai-sidebar"]')?.querySelectorAll<HTMLElement>('[data-ai-chat-composer-root]:not([inert])');
        const composer = Array.from(composers ?? []).find((node) => {
          const rect = node.getBoundingClientRect();
          return !node.closest('[inert]') && rect.width > 0 && rect.height > 0;
        });
        if (composer) maxHeight = Math.min(window.innerHeight, composer.getBoundingClientRect().top) - host.getBoundingClientRect().top - 12;
      }
      host.style.maxHeight = `${Math.max(0, maxHeight)}px`;
      host.style.maxWidth = `${Math.max(0, agentsOnly ? box.right - 8 : window.innerWidth - box.left - 8)}px`;
    };
    place();
    host.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
      anchor.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      if (!host.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    const viewport = isMobile && phoneChatList ? window.visualViewport : null;
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [anchorRef, onClose, isMobile, phoneChatList, agentsOnly]);

  useEffect(() => {
    if (selected) hostRef.current?.querySelector(`[data-command-key="${selected.key}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected?.key]);

  useEffect(() => {
    if (pastChatsFirst && sessionPagingEnabled) void refreshHistorySessions();
  }, [pastChatsFirst, sessionPagingEnabled, refreshHistorySessions]);

  return (
    // eslint-disable-next-line hypertask-ui/no-new-choice-menus -- HTPR-7518 comments 296781/296783 approve this named anchored command host; expires 2026-11-04.
    <ul
      role="listbox"
      aria-activedescendant={selected ? `agent-sidebar-command-${selected.key}` : undefined}
      id={agentsOnly ? "agent-sidebar-agents" : "agent-sidebar-conversations"}
      data-testid={agentsOnly ? "agent-sidebar-agents" : "agent-sidebar-conversations"}
      aria-label={agentsOnly ? "Agent sessions" : "Sidebar conversations"}
      ref={hostRef}
      tabIndex={-1}
      className={`absolute ${agentsOnly ? "right-0" : "left-0"} top-full z-[1200] mt-1 w-72 overflow-y-auto ${agentsOnly ? "rounded-[5px]" : "rounded-md"} bg-modalBackground py-1 text-white-black shadow-md outline-none`}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.stopPropagation();
          onClose();
          anchorRef.current?.focus({ preventScroll: true });
          return;
        }
        if (!selected) return;
        const position = findCommandPosition(groups, selected);
        if (!position) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          const next = Math.max(0, Math.min(commands.length - 1, position.commandIndex + (event.key === "ArrowDown" ? 1 : -1)));
          setSelectedKey(commands[next].key);
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          choose(position.command);
        }
      }}
    >
      {agentsOnly && !commands.length && <li className="px-3 py-2 text-content text-icon-dark-gray">No agents on this board</li>}
      <CommandList
        isMobile={isMobile}
        inline
        groupIndex={0}
        commandLists={commands}
        selectedCommand={selected ?? null}
        handleMouseLeave={() => {}}
        handleMouseEnter={(command) => setSelectedKey(command.key)}
        commandRef={rowRef}
        onClickHandler={choose}
      />
    </ul>
  );
}
