import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import type { ITeam } from "@/models/model";
import { deriveTeamBilling } from "@/lib/deriveCurrentBoardBilling";
import { getLastBoardTeam } from "@/lib/lastBoardTeam";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { useGetAllTeamsMinimal } from "@/hooks/MultiPages/useGetAllTeamsMinimal";

export function useAiChatModelPreference() {
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const boardBilling = useCurrentBoardBilling();
  const { data: teams = [] } = useGetAllTeamsMinimal(
    currentUser?.id ?? null,
    undefined,
    { enabled: !currentProject?.teamId },
  );
  const lastTeamId = getLastBoardTeam();
  const teamId = currentProject?.teamId ??
    teams.find((team) => team.id === lastTeamId)?.id ?? teams[0]?.id ?? null;
  // Sidebar teams omit subscription status, so fetch the full billing source.
  const { data: team } = useQuery<ITeam | null>({
    queryKey: ["settingsTeam", currentUser?.id ?? null, teamId],
    enabled: Boolean(teamId) && !currentProject?.teamId,
    queryFn: async () => {
      const { data } = await axios.get<ITeam>("/api/teams/getTeam", {
        params: { teamId },
      });
      return data ?? null;
    },
    refetchOnWindowFocus: false,
  });

  const billing = currentProject?.teamId ? boardBilling : deriveTeamBilling(team);
  const preference = useAiModelPreference("aiChat", { teamId, billing });

  return { ...preference, modelTeamId: teamId, modelBilling: billing };
}
