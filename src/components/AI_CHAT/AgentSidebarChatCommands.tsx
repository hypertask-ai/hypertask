"use client";

import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import CommandList from "@/components/Modals/commands/HTC/CommandList";
import { findCommandPosition } from "@/components/Modals/commands/HTC/commandSelection";
import type { ICommandList } from "@/components/Modals/commands/HTC/HTCTypes";
import { CommandMode } from "@/models/enums";
import type { SidebarChatContext } from "@/app/agents/chat/agentChatTypes";

export function AgentSidebarChatCommands({ context, anchorRef, onClose }: {
  context: SidebarChatContext;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const isMobile = useContext(MobileViewContext);
  const hostRef = useRef<HTMLUListElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [selectedKey, setSelectedKey] = useState(context.target.kind === "ai" ? "ai" : context.target.agent.id);
  const commands = useMemo<ICommandList[]>(() => [
    { key: "ai", name: "AI chat", commandMode: CommandMode.GoToAgentChat },
    ...context.agents.map((agent) => ({
      key: agent.id,
      name: `${agent.displayName} · ${agent.status}${agent.deliveryMode ? ` · ${agent.deliveryMode}` : ""}`,
      commandMode: CommandMode.GoToAgentChat,
    })),
    ...(context.error ? [{ key: "retry", name: `${context.error}. Retry`, commandMode: CommandMode.GoToAgentChat }] : []),
  ], [context.agents, context.error]);
  const groups = [{ group: "Conversations", commandLists: commands }];
  const selected = commands.find((command) => command.key === selectedKey) ?? commands[0];
  const choose = (command: ICommandList) => {
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
      host.style.maxHeight = `${Math.max(0, window.innerHeight - box.bottom - 12)}px`;
      host.style.maxWidth = `${Math.max(0, window.innerWidth - box.left - 8)}px`;
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
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorRef, onClose]);

  useEffect(() => {
    hostRef.current?.querySelector(`[data-command-key="${selected.key}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected.key]);

  return (
    // eslint-disable-next-line hypertask-ui/no-new-choice-menus -- HTPR-7518 comments 296781/296783 approve this named anchored command host; expires 2026-11-04.
    <ul
      role="listbox"
      aria-activedescendant={`agent-sidebar-command-${selected.key}`}
      id="agent-sidebar-conversations"
      data-testid="agent-sidebar-conversations"
      aria-label="Sidebar conversations"
      ref={hostRef}
      tabIndex={-1}
      className="absolute left-0 top-full z-[1200] mt-1 w-72 overflow-y-auto rounded-md bg-modalBackground py-1 text-white-black shadow-md outline-none"
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.stopPropagation();
          onClose();
          anchorRef.current?.focus({ preventScroll: true });
          return;
        }
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
      <CommandList
        isMobile={isMobile}
        inline
        groupIndex={0}
        commandLists={commands}
        selectedCommand={selected}
        handleMouseLeave={() => {}}
        handleMouseEnter={(command) => setSelectedKey(command.key)}
        commandRef={rowRef}
        onClickHandler={choose}
      />
    </ul>
  );
}
