"use client";

import axios from "axios";
import { useCallback, useEffect, useMemo } from "react";
import nookies, { parseCookies } from "nookies";
import { useQuery } from "@tanstack/react-query";
import { useGetAllProjectsMinimal } from "@/hooks/MultiPages/useGetAllProjectsMinimal";
import { useGetAllTeamMembers } from "@/hooks/MultiPages/useGetAllTeamMembers";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";
import { deriveTeamBilling } from "@/lib/deriveCurrentBoardBilling";
import {
  getInitialSettingsTeamId,
  getSettingsProjectForTeam,
} from "@/lib/settingsTeamSelection";
import { IProject, ITeam, IUser } from "@/models/model";
import {
  currentProjectAtom,
  currentUserAtom,
  selectedSettingsTeamIdAtom,
} from "@/store";
import { useRecoilState, useRecoilValue } from "@/lib/state";

interface TeamMembersData {
  owner: IUser | null;
  members: IUser[];
}

const EMPTY_MEMBERS_DATA: TeamMembersData = {
  owner: null,
  members: [],
};

const getPreviousBoardProjectId = () => {
  const previousBoard = parseCookies().previousBoard;
  const [projectId] = previousBoard?.split("|&|") ?? [];
  return projectId?.split("-")[1] ?? null;
};

const normalizeTeamMembers = (value: unknown): TeamMembersData => {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return EMPTY_MEMBERS_DATA;
  }

  const data = value as Partial<TeamMembersData>;

  return {
    owner: data.owner ?? null,
    members: Array.isArray(data.members) ? data.members : [],
  };
};

const mergeProjects = (teams: ITeam[], projects: IProject[]) => {
  const byId = new Map<number, IProject>();

  for (const project of projects) byId.set(project.id, project);
  for (const team of teams) {
    for (const project of team.projects ?? []) {
      if (!byId.has(project.id)) byId.set(project.id, project);
    }
  }

  return Array.from(byId.values());
};

export const useSettingsTeam = () => {
  const currentUser = useRecoilValue(currentUserAtom);
  const [currentProject, setCurrentProject] = useRecoilState(currentProjectAtom);
  const [teamId, setTeamId] = useRecoilState(selectedSettingsTeamIdAtom);
  const {
    data: teamsData = [],
    isFetched: teamsFetched,
    isLoading: teamsLoading,
  } = useGetAllTeamsMinimal(currentUser?.id ?? null);
  const {
    data: projectsData = [],
    isFetched: projectsFetched,
  } = useGetAllProjectsMinimal(["projectsAllMinimal"]);

  const teams = useMemo(
    () => (Array.isArray(teamsData) ? (teamsData as ITeam[]) : []),
    [teamsData]
  );
  const projects = useMemo(
    () =>
      mergeProjects(
        teams,
        Array.isArray(projectsData) ? (projectsData as IProject[]) : []
      ),
    [projectsData, teams]
  );
  const previousBoardProjectId = useMemo(
    () => getPreviousBoardProjectId(),
    []
  );

  useEffect(() => {
    if (!teamsFetched) return;

    const availableTeamIds = teams.map((availableTeam) => availableTeam.id);
    if (teamId && availableTeamIds.includes(teamId)) return;

    setTeamId(
      getInitialSettingsTeamId(
        availableTeamIds,
        currentProject,
        projects,
        previousBoardProjectId
      )
    );
  }, [
    currentProject,
    previousBoardProjectId,
    projects,
    setTeamId,
    teamId,
    teams,
    teamsFetched,
  ]);

  const project = useMemo(
    () =>
      getSettingsProjectForTeam(
        teamId,
        currentProject,
        projects,
        previousBoardProjectId
      ),
    [currentProject, previousBoardProjectId, projects, teamId]
  );

  useEffect(() => {
    if (!teamId || currentProject?.teamId === teamId) return;

    if (project) {
      const selectedTeam = teams.find((availableTeam) => availableTeam.id === teamId);
      setCurrentProject({
        ...project,
        teamId,
        team: {
          ...(selectedTeam ?? project.team ?? {}),
          id: teamId,
          title: selectedTeam?.title ?? project.team?.title,
        } as ITeam,
      });
      return;
    }

    if (teamsFetched && projectsFetched) setCurrentProject(null);
  }, [
    currentProject?.teamId,
    project,
    projectsFetched,
    setCurrentProject,
    teamId,
    teams,
    teamsFetched,
  ]);

  const teamQuery = useQuery<ITeam | null>({
    queryKey: ["settingsTeam", currentUser?.id, teamId],
    queryFn: async () => {
      const response = await axios.get<ITeam>("/api/teams/getTeam", {
        params: { teamId },
      });
      return response.data ?? null;
    },
    enabled: Boolean(teamId),
    refetchOnWindowFocus: false,
  });
  const { refetch: refetchTeamQuery } = teamQuery;

  const {
    data: teamMembersData,
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useGetAllTeamMembers(
    ["settingsTeamMembers", currentUser?.id, teamId],
    teamId ?? "",
    EMPTY_MEMBERS_DATA
  );

  const team = teamQuery.data ?? null;
  const selectTeam = useCallback(
    (selectedTeamId: string) => {
      setTeamId(selectedTeamId);

      const targetProject = getSettingsProjectForTeam(
        selectedTeamId,
        null,
        projects
      );
      if (targetProject) {
        nookies.set(
          null,
          "previousBoard",
          `project-${targetProject.id}|&|undefined`,
          { maxAge: 600 * 60 * 24 * 7, path: "/" }
        );
      }
    },
    [projects, setTeamId]
  );
  const refetchTeam = useCallback(async () => {
    const result = await refetchTeamQuery();
    return result.data ?? null;
  }, [refetchTeamQuery]);

  return {
    availableTeams: teams,
    billing: deriveTeamBilling(team),
    isLoading:
      teamsLoading ||
      (Boolean(teamId) && (teamQuery.isLoading || membersLoading)),
    ownerAndMembers: normalizeTeamMembers(teamMembersData),
    project,
    projects,
    refetchMembers,
    refetchTeam,
    selectTeam,
    team,
    teamId,
  };
};
