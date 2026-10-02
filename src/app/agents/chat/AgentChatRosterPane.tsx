"use client";

import { MOBILE_TARGET } from "@/lib/configs/general.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { Plus } from "lucide-react";
import AgentSelect, { AgentOption } from "../AgentSelect";
import { RosterRow } from "./AgentChatFeedItems";
import type { useAgentChatNavigation } from "./useAgentChatNavigation";
import type { useAgentChatRoster } from "./useAgentChatRoster";
import type { useAgentChatSession } from "./useAgentChatSession";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "isNarrow"
  | "setShowCreateAgent"
  | "roomsEnabled"
  | "router"
  | "search"
  | "setSearch"
  | "teamId"
  | "rosterError"
  | "agents"
  | "selectedId"
  | "rosterNow"
> &
  Pick<
  ReturnType<typeof useAgentChatNavigation>,
  | "teams"
  | "roster"
> &
  Pick<
  ReturnType<typeof useAgentChatRoster>,
  | "setTeamFilter"
> &
  Pick<
  ReturnType<typeof useAgentChatSession>,
  | "selectAgent"
>;

export function AgentChatRosterPane({
  isNarrow, setShowCreateAgent, roomsEnabled, router, search, setSearch, teams, teamId,
  setTeamFilter, rosterError, agents, roster, selectedId, selectAgent, rosterNow,
}: Props) {
  const rosterPane = (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        isNarrow ? "flex-1" : "w-[300px] shrink-0 border-r border-comment-description-border",
      )}
    >
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <h1 className="px-1 text-[16px] font-semibold">Agent Chat</h1>
          <button
            type="button"
            onClick={() => setShowCreateAgent(true)}
            aria-label="Add agent"
            className={cn(
              MOBILE_TARGET,
              "rounded-[4px] text-text-light-gray hover:text-white-black hover:bg-hoverCardBackground",
            )}
          >
            <Plus size={16} />
          </button>
        </div>
        {roomsEnabled && (
          <button
            type="button"
            onClick={() => router.push("/agents/chat?view=rooms")}
            className="mt-2 flex w-full items-center justify-between rounded-[4px] bg-cardBackground px-3 py-2 text-left text-dense hover:bg-hoverCardBackground"
          >
            <span>Board rooms</span>
            <span className="text-meta text-text-light-gray">All bots</span>
          </button>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search agents"
          aria-label="Search agents"
          className="mt-2 w-full rounded-[4px] bg-cardBackground px-3 py-1.5 text-dense outline-none placeholder:text-text-light-gray"
        />
        {teams.length > 0 && (
          <AgentSelect
            value={teamId ?? ""}
            ariaLabel="Filter agents by team"
            onChange={(next) => setTeamFilter(next || null)}
            className="mt-2 w-full"
          >
            <AgentOption value="">All teams</AgentOption>
            {teams.map((team) => (
              <AgentOption key={team.id} value={team.id}>
                {team.name}
              </AgentOption>
            ))}
          </AgentSelect>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {rosterError && (
          <p className="px-2 py-3 text-meta text-red-500">{rosterError}</p>
        )}
        {!rosterError && !agents && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            Loading agents…
          </p>
        )}
        {agents && roster.length === 0 && (
          <p className="px-2 py-3 text-meta text-text-light-gray">
            No agents match.
          </p>
        )}
        {roster.map((agent) => (
          <RosterRow
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            onSelect={selectAgent}
            now={rosterNow}
          />
        ))}
      </div>
    </aside>
  );

  return rosterPane;
}
