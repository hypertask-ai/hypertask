import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import type { ITeam } from "@/models/model";
import { deriveTeamBilling } from "@/lib/deriveCurrentBoardBilling";
import { getLastBoardTeam } from "@/lib/lastBoardTeam";
import { useState } from "react";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";
import { getAiModelPreferenceIds } from "@/lib/aiModelPreferences";
import { AUTO_MODEL_OPTION_ID, getAiModelOptionById, toAutoModelOption } from "@/lib/aiModelOptions";
import type { TAiModal } from "@/models/AI_Task_writer_model";
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
  const autoFlag = useFlag(HTPR_7915_AUTO_MODEL_FLAG);
  const { data: userPreferences } = useGetUserPreferences();
  const [override, setOverride] = useState<{ teamId: typeof teamId; auto: boolean } | null>(null);
  const autoOverride = override?.teamId === teamId ? override.auto : null;
  const stored = getAiModelPreferenceIds(userPreferences.aiModelPreferences, "aiChat", teamId);
  const storedPick = stored.teamScoped ?? stored.global;
  const derivedAuto = storedPick === AUTO_MODEL_OPTION_ID ||
    (!getAiModelOptionById(storedPick) && preference.usesPlanDefault);
  const base = { ...preference, modelTeamId: teamId, modelBilling: billing };
  if (!autoFlag) return base;

  const autoActive = autoOverride ?? derivedAuto;
  const setAiOption = (option: TAiModal) => {
    setOverride({ teamId, auto: option.id === AUTO_MODEL_OPTION_ID });
    preference.setAiOption(option);
  };

  return {
    ...base,
    currentAiOption: autoActive ? toAutoModelOption(preference.currentAiOption) : preference.currentAiOption,
    setAiOption,
  };
}
