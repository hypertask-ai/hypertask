import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilValue } from "@/lib/state";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7010_HAIKU_5_5_FLAG, LUNA_FREE_PLAN_FLAG } from "@/lib/flags/keys";
import {
  getDefaultAiModelOptionForPlan,
  getAiModelOptionById,
  preferredAiModelOption,
  resolveAiModelOption,
} from "@/lib/aiModelOptions";
import { isByokProviderEnabledForSource } from "@/lib/byokSelectedProviderGate";
import {
  getAiModelPreferenceIds,
  mergeAiModelPreferenceUpdates,
  type TAiModelPreferenceSurface,
} from "@/lib/aiModelPreferences";
import type { TAiModal } from "@/models/AI_Task_writer_model";
import { currentProjectAtom } from "@/store";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "./useGetUserPreferences";
import { useCurrentBoardBilling } from "./useCurrentBoardBilling";
import type { TeamBillingSnapshot } from "@/lib/deriveCurrentBoardBilling";

export function useAiModelPreference(
  surface: TAiModelPreferenceSurface,
  {
    includeBoardFallback = true,
    teamId,
    billing: billingOverride,
    boardDefaultId: boardDefaultOverride,
  }: {
    includeBoardFallback?: boolean;
    teamId?: string | number | null;
    billing?: TeamBillingSnapshot | null;
    boardDefaultId?: string | null;
  } = {},
) {
  const currentProject = useRecoilValue(currentProjectAtom);
  const lunaFree = useFlag(LUNA_FREE_PLAN_FLAG);
  const haiku55Enabled = useFlag(HTPR_7010_HAIKU_5_5_FLAG);
  const preferredOption = haiku55Enabled ? getAiModelOptionById("claude-haiku-5-5")! : preferredAiModelOption;
  const boardBilling = useCurrentBoardBilling();
  const billing = billingOverride === undefined ? boardBilling : billingOverride;
  const queryClient = useQueryClient();
  const { data: userPreferences } = useGetUserPreferences();
  const currentTeamId =
    teamId === undefined ? currentProject?.teamId : teamId;
  const scopedBilling =
    currentTeamId == null || billing?.teamId === String(currentTeamId)
      ? billing
      : null;
  const teamFeatureModels = useQuery<
    Record<string, { model: string | null; effectiveModel: string | null }>
  >({
    queryKey: ["teamAiFeatureModels", currentTeamId, haiku55Enabled],
    enabled: Boolean(currentTeamId),
    queryFn: async () => {
      const { data } = await axios.get("/api/teams/aiFeatureModels", {
        params: { teamId: currentTeamId },
      });
      return data;
    },
  });
  const boardDefaultId = boardDefaultOverride === undefined
    ? currentProject?.ai_custom_instructions?.[0]?.model_selected
    : boardDefaultOverride;
  const storedOptionIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    surface,
    currentTeamId,
  );
  const planDefault = getDefaultAiModelOptionForPlan(
    scopedBilling?.storePlanId,
    isByokProviderEnabledForSource(
      scopedBilling?.byokProviderFlags,
      preferredOption.source,
    ),
    lunaFree,
    haiku55Enabled,
  );
  const resolveOption = useCallback(
    () =>
      resolveAiModelOption(
        [
          storedOptionIds.teamScoped,
          storedOptionIds.global,
          teamFeatureModels.data?.[surface]?.model,
          includeBoardFallback ? boardDefaultId : undefined,
        ],
        planDefault,
        haiku55Enabled,
      ),
    [
      haiku55Enabled,
      boardDefaultId,
      includeBoardFallback,
      planDefault,
      storedOptionIds.global,
      storedOptionIds.teamScoped,
      surface,
      teamFeatureModels.data,
    ],
  );
  const [currentAiOption, setCurrentAiOption] = useState(resolveOption);

  useEffect(() => {
    setCurrentAiOption(resolveOption());
  }, [resolveOption]);

  const setAiOption = useCallback(
    (option: TAiModal) => {
      const validOption = getAiModelOptionById(option.id, haiku55Enabled);
      if (!validOption) return;

      setCurrentAiOption(validOption);
      if (!currentTeamId) return;

      void queryClient.cancelQueries(
        { queryKey: USER_PREFERENCES_QUERY_KEY },
        { revert: false },
      );
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (previous) => ({
          ...(previous ?? userPreferences),
          aiModelPreferences: mergeAiModelPreferenceUpdates(
            previous?.aiModelPreferences ?? userPreferences.aiModelPreferences,
            { [surface]: validOption.id },
            currentTeamId,
          ),
        }),
      );

      void axios
        .post("/api/users/preferences", {
          aiModelPreferences: { [surface]: validOption.id },
          aiModelPreferencesTeamId: currentTeamId,
        })
        .then((response) => {
          if (response.status === 200 && response.data.settings) {
            queryClient.setQueryData<IUserPreferences>(
              USER_PREFERENCES_QUERY_KEY,
              (previous) => ({
                ...(previous ?? userPreferences),
                ...response.data.settings,
              }),
            );
          }
        })
        .catch((error) => {
          console.log("useAiModelPreference update error:", error);
        });
    },
    [currentTeamId, haiku55Enabled, queryClient, surface, userPreferences],
  );

  return { currentAiOption, setAiOption };
}
