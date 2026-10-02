"use client";

import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { getLastBoardTeam } from "@/lib/lastBoardTeam";
import { IProject } from "@/models/model";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import type { TAgent } from "../AgentsRegister";
import { DETAILS_COLLAPSED_KEY, EMPTY_PROJECTS } from "./agentChatTypes";
import type { useAgentChatState } from "./useAgentChatState";

type Props = Pick<
  ReturnType<typeof useAgentChatState>,
  | "rosterGenRef"
  | "setAgents"
  | "setRosterError"
  | "setDetailsCollapsed"
  | "setTeamId"
  | "setIsNarrow"
  | "setDetailsSheetOpen"
>;

export function useAgentChatRoster({
  rosterGenRef, setAgents, setRosterError, setDetailsCollapsed, setTeamId, setIsNarrow,
  setDetailsSheetOpen,
}: Props) {
  const loadAgents = useCallback(async () => {
    const res = await fetch("/api/agents/owned");
    const data = (await res.json()) as {
      success?: boolean;
      agents?: TAgent[];
      error?: string;
    };
    if (!res.ok || !data.success || !Array.isArray(data.agents)) {
      throw new Error(data.error ?? "Failed to load agents");
    }
    return data.agents;
  }, []);

  // The roster is owner-scoped and small; one fetch per visit is enough.
  useEffect(() => {
    let cancelled = false;
    const myGen = ++rosterGenRef.current;
    loadAgents()
      .then((loaded) => {
        if (!cancelled && myGen === rosterGenRef.current) {
          setAgents(loaded);
          setRosterError(null);
        }
      })
      .catch((e) => {
        if (!cancelled && myGen === rosterGenRef.current) {
          setRosterError(
            e instanceof Error ? e.message : "Failed to load agents",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAgents]);

  // Project list backing both the "@" task search and ticket-id link
  // resolution; same query key as the rest of the app, so it is shared cache.
  const {
    data: mentionProjects = EMPTY_PROJECTS,
    isFetching: mentionProjectsLoading,
    isError: mentionProjectsLoadError,
  } = useGetAllProjectsMinimal(["projectsAllMinimal"]);
  const projectIdByPrefix = useMemo(() => {
    const byPrefix = new Map<string, number>();
    for (const project of mentionProjects as IProject[]) {
      if (project.uniqueIdentifier) byPrefix.set(project.uniqueIdentifier, project.id);
    }
    return byPrefix;
  }, [mentionProjects]);
  const projectIdForPrefix = useCallback(
    (prefix: string) => projectIdByPrefix.get(prefix),
    [projectIdByPrefix],
  );

  // The collapse choice is remembered per browser; default to open.
  useEffect(() => {
    try {
      setDetailsCollapsed(
        window.localStorage.getItem(DETAILS_COLLAPSED_KEY) === "1",
      );
    } catch {
      // Private browsing and hardened policies can reject localStorage.
    }
  }, []);

  // Default the team filter to whatever team the user was last working in on
  // a board (HTPR-6036), not a separately-remembered Agent Chat preference:
  // switching boards to another team and then opening Agent Chat should show
  // that team's agents. A manual change below only affects this component's
  // own state, so it wins for the rest of this visit without being written
  // back here (the keyboard team-cycle shortcut is the one thing that does
  // update the shared last-board-team value from this page).
  useEffect(() => {
    setTeamId(getLastBoardTeam());
  }, []);

  const setTeamFilter = (next: string | null) => {
    setTeamId(next);
  };

  // Below 900px the three panes stack: roster list, then chat, and the details
  // move behind an info button. useLayoutEffect so a reload on a phone does
  // not paint the desktop three-pane shell for a frame.
  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const onChange = () => {
      setIsNarrow(query.matches);
      // The details sheet only exists in the narrow layout; widening past the
      // breakpoint would otherwise unmount it with the flag still set, leaving
      // it to spring open on the way back.
      if (!query.matches) setDetailsSheetOpen(false);
    };
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);


  return {
    loadAgents, mentionProjects, mentionProjectsLoading, mentionProjectsLoadError,
    projectIdForPrefix, setTeamFilter,
  };
}
