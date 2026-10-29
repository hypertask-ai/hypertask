"use client";

import { listTeams } from "@/lib/agents/registerView";
import { setLastBoardTeam } from "@/lib/lastBoardTeam";
import { useRecoilValue } from "@/lib/state";
import { agentChatTeamCycleAtom } from "@/store";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { agentDictationProjectId } from "./AgentChatFeedItems";
import { sortRosterByActivity } from "./rosterSort";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "embedded"
  | "agents"
  | "selectedId"
  | "isMbl"
  | "mobileLayoutEnabled"
  | "teamId"
  | "setAgentChatMobileFullscreen"
  | "setMobileTopBarTitle"
  | "setTeamId"
  | "search"
>;

export function useAgentChatNavigation({
  embedded, agents, selectedId, isMbl, mobileLayoutEnabled, teamId,
  setAgentChatMobileFullscreen, setMobileTopBarTitle, setTeamId, search,
}: Props) {
  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const isExternal = selectedAgent?.runtimeType === "EXTERNAL";
  const mobileFullscreenChrome = Boolean(
    !embedded && isMbl && selectedAgent,
  );
  const reuseAiComposer = Boolean(embedded || isMbl);
  const dictationProjectId = useMemo(
    () =>
      embedded ? embedded.projectId : isMbl
        ? agentDictationProjectId(selectedAgent, teamId)
        : null,
    [embedded?.projectId, isMbl, selectedAgent, teamId],
  );

  useEffect(() => {
    if (embedded) return;
    setAgentChatMobileFullscreen(mobileFullscreenChrome);
    return () => setAgentChatMobileFullscreen(false);
  }, [mobileFullscreenChrome, setAgentChatMobileFullscreen]);

  useEffect(() => {
    if (embedded || !mobileLayoutEnabled || !isMbl || mobileFullscreenChrome) return;
    setMobileTopBarTitle(selectedAgent?.displayName ?? "Agents");
    return () => setMobileTopBarTitle(null);
  }, [
    mobileLayoutEnabled,
    isMbl,
    mobileFullscreenChrome,
    selectedAgent?.displayName,
    setMobileTopBarTitle,
  ]);

  const teams = useMemo(() => listTeams(agents ?? []), [agents]);

  const teamCycle = useRecoilValue(agentChatTeamCycleAtom);
  const teamCycleSeenRef = useRef(teamCycle?.seq ?? 0);
  const stepTeamCycle = useCallback(
    (direction: 1 | -1) => {
      const stops: (string | null)[] = [null, ...teams.map((t) => t.id)];
      const currentIndex = stops.indexOf(teamId);
      const nextIndex =
        (((currentIndex === -1 ? 0 : currentIndex) + direction) %
          stops.length +
          stops.length) %
        stops.length;
      const next = stops[nextIndex];
      setTeamId(next);
      if (next) setLastBoardTeam(next);
    },
    [teams, teamId],
  );
  useEffect(() => {
    if (!teamCycle || teamCycle.seq === teamCycleSeenRef.current) return;
    if (agents === null) return;
    teamCycleSeenRef.current = teamCycle.seq;
    stepTeamCycle(teamCycle.direction);

  }, [teamCycle, teams, agents]);

  const roster = useMemo(() => {
    const visible = (agents ?? []).filter(
      (a) => a.revokedAt === null && a.archivedAt === null,
    );
    const activeTeam =
      teamId && teams.some((team) => team.id === teamId) ? teamId : null;
    const inTeam = activeTeam
      ? visible.filter((a) =>
          (a.boards ?? []).some((board) => board.teamId === activeTeam),
        )
      : visible;
    const needle = search.trim().toLowerCase();
    const matching = needle
      ? inTeam.filter((a) => a.displayName.toLowerCase().includes(needle))
      : inTeam;
    return sortRosterByActivity(matching);
  }, [agents, search, teamId, teams]);


  return {
    selectedAgent, isExternal, mobileFullscreenChrome, reuseAiComposer, dictationProjectId, teams,
    stepTeamCycle, roster,
  };
}
