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
  | "agents"
  | "selectedId"
  | "mobileFullscreenFlag"
  | "isMbl"
  | "mobileLayoutEnabled"
  | "teamId"
  | "setAgentChatMobileFullscreen"
  | "setMobileTopBarTitle"
  | "setTeamId"
  | "search"
  | "liveSortEnabled"
>;

export function useAgentChatNavigation({
  agents, selectedId, mobileFullscreenFlag, isMbl, mobileLayoutEnabled, teamId,
  setAgentChatMobileFullscreen, setMobileTopBarTitle, setTeamId, search, liveSortEnabled,
}: Props) {
  const selectedAgent = useMemo(
    () => (agents ?? []).find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );
  const isExternal = selectedAgent?.runtimeType === "EXTERNAL";
  // Flag + phone + a real agent open: hide app chrome and use AI chat controls.
  const mobileFullscreenChrome = Boolean(
    mobileFullscreenFlag && isMbl && selectedAgent,
  );
  const reuseAiComposer = Boolean(mobileFullscreenFlag && isMbl);
  const dictationProjectId = useMemo(
    () =>
      isMbl && (mobileLayoutEnabled || mobileFullscreenFlag)
        ? agentDictationProjectId(selectedAgent, teamId)
        : null,
    [isMbl, mobileLayoutEnabled, mobileFullscreenFlag, selectedAgent, teamId],
  );

  useEffect(() => {
    setAgentChatMobileFullscreen(mobileFullscreenChrome);
    return () => setAgentChatMobileFullscreen(false);
  }, [mobileFullscreenChrome, setAgentChatMobileFullscreen]);

  useEffect(() => {
    if (!mobileLayoutEnabled || !isMbl || mobileFullscreenChrome) return;
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

  // Alt+Shift+Arrow team cycling (HTPR-6036): the app-wide keydown handler
  // (GloablProviders.tsx, alongside Ctrl+B) bumps this atom's seq since it
  // has no other way to reach this page's team filter state. "All teams"
  // (null) is one of the stops, matching the dropdown below.
  const teamCycle = useRecoilValue(agentChatTeamCycleAtom);
  // Seeded from whatever the atom already holds at mount, not 0: the atom
  // retains its last event, so a fresh mount (e.g. navigating back to Agent
  // Chat after cycling teams elsewhere) must acknowledge that stale seq
  // instead of replaying it as a brand-new press.
  const teamCycleSeenRef = useRef(teamCycle?.seq ?? 0);
  // Shared by the atom-driven effect below and the Ctrl+K palette's
  // Next/Previous team entries (AllCommands.ts -> chatPaletteCommands.ts).
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
    // The roster (and so `teams`) isn't loaded yet: stepTeamCycle's stops
    // array would be just [null], silently losing the cycle. Leave the seq
    // unacknowledged so this effect re-runs and replays it once agents load.
    if (agents === null) return;
    teamCycleSeenRef.current = teamCycle.seq;
    stepTeamCycle(teamCycle.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stepTeamCycle
    // intentionally excluded: it closes over teamId, and re-running this on
    // every teamId change (including the ones it causes itself) would fight
    // the cycle. Only a new atom event should trigger a step.
  }, [teamCycle, teams, agents]);

  const roster = useMemo(() => {
    const visible = (agents ?? []).filter(
      (a) => a.revokedAt === null && a.archivedAt === null,
    );
    // A remembered team that no longer exists must not empty the roster.
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
    return sortRosterByActivity(matching, liveSortEnabled);
  }, [agents, search, teamId, teams, liveSortEnabled]);


  return {
    selectedAgent, isExternal, mobileFullscreenChrome, reuseAiComposer, dictationProjectId, teams,
    stepTeamCycle, roster,
  };
}
