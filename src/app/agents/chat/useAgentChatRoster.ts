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
  | "embedded"
  | "rosterGenRef"
  | "setAgents"
  | "setRosterError"
  | "setDetailsCollapsed"
  | "setTeamId"
  | "setIsNarrow"
  | "setDetailsSheetOpen"
>;

export function useAgentChatRoster({
  embedded, rosterGenRef, setAgents, setRosterError, setDetailsCollapsed, setTeamId, setIsNarrow,
  setDetailsSheetOpen,
}: Props) {
  const loadAgents = useCallback(async () => {
    if (embedded) return [embedded.agent];
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
  }, [embedded?.agent]);

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

  useEffect(() => {
    try {
      setDetailsCollapsed(
        window.localStorage.getItem(DETAILS_COLLAPSED_KEY) === "1",
      );
    } catch {
    }
  }, []);

  useEffect(() => {
    setTeamId(getLastBoardTeam());
  }, []);

  const setTeamFilter = (next: string | null) => {
    setTeamId(next);
  };

  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const onChange = () => {
      setIsNarrow(query.matches);
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
