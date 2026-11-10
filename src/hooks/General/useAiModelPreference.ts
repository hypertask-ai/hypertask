import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useRecoilValue } from "@/lib/state";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7915_AUTO_MODEL_FLAG } from "@/lib/flags/definitions/htpr-7915-auto-model";
import { HTPR_8995_PICKER_AUTO_FLAG } from "@/lib/flags/definitions/htpr-8995-picker-auto";
import { useAiDefaultModelContext } from "@/hooks/useAiDefaultModelContext";
import {
  AUTO_MODEL_OPTION_ID,
  toAutoModelOption,
  getDefaultAiModelOptionForPlan,
  getAiModelOptionById,
  isOpenAiOnlyPaidTeam,
  preferredAiModelOption,
  resolveAiModelOption,
} from "@/lib/aiModelOptions";
import { hasHaikuByokProviderFlags, isByokProviderEnabledForSource } from "@/lib/byokSelectedProviderGate";
import {
  getAiModelPreferenceIds,
  mergeAiModelPreferenceUpdates,
  teamAiFeatureModelsQueryKey,
  type TAiModelPreferenceSurface,
} from "@/lib/aiModelPreferences";
import {
  parseAiThinkingPreference,
  type TAiThinkingPreference,
} from "@/lib/aiThinkingPreference";
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
  const haikuDefaultEnabled = true;
  const haiku55Enabled = true;
  const boardBilling = useCurrentBoardBilling();
  const billing = billingOverride === undefined ? boardBilling : billingOverride;
  const queryClient = useQueryClient();
  const autoModelEnabled = useFlag(HTPR_7915_AUTO_MODEL_FLAG);
  const taskWriterAuto = useFlag(HTPR_8995_PICKER_AUTO_FLAG);
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
    queryKey: teamAiFeatureModelsQueryKey(currentTeamId, haiku55Enabled, haikuDefaultEnabled),
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
  const defaultContext = useAiDefaultModelContext(currentTeamId == null ? null : String(currentTeamId));
  const planDefaultFor = (context: typeof defaultContext) => haikuDefaultEnabled || haiku55Enabled
    ? getDefaultAiModelOptionForPlan(
        scopedBilling?.storePlanId,
        hasHaikuByokProviderFlags(scopedBilling?.byokProviderFlags),
        true,
        haikuDefaultEnabled,
        context,
      )
    : getDefaultAiModelOptionForPlan(
        scopedBilling?.storePlanId,
        isByokProviderEnabledForSource(
          scopedBilling?.byokProviderFlags,
          preferredAiModelOption.source,
        ),
      );
  const planDefault = planDefaultFor(defaultContext);
  const chosenOptionIds = [
    storedOptionIds.teamScoped,
    storedOptionIds.global,
    teamFeatureModels.data?.[surface]?.model,
    includeBoardFallback ? boardDefaultId : undefined,
  ];
  const usesPlanDefault = !chosenOptionIds.some((id) => getAiModelOptionById(id, haiku55Enabled));
  const openAiOnlyDefaultApplies = usesPlanDefault &&
    isOpenAiOnlyPaidTeam({ ...defaultContext, plan: scopedBilling?.storePlanId });
  const agentSessionAiOption = openAiOnlyDefaultApplies
    ? planDefaultFor({ ...defaultContext, openaiOnlyDefaultEnabled: false })
    : null;
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
      const autoPick = option.id === AUTO_MODEL_OPTION_ID && (
        (autoModelEnabled && surface === "aiChat") ||
        (taskWriterAuto && surface === "taskWriter")
      );
      const validOption = autoPick ? toAutoModelOption(resolveOption()) : getAiModelOptionById(option.id, haiku55Enabled);
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
              (previous) => {
                const thinking = previous?.aiModelPreferences?.thinking;
                const settings = response.data.settings;
                return {
                  ...(previous ?? userPreferences),
                  ...settings,
                  ...(thinking
                    ? { aiModelPreferences: { ...settings.aiModelPreferences, thinking } }
                    : {}),
                };
              },
            );
          }
        })
        .catch((error) => {
          console.log("useAiModelPreference update error:", error);
        });
    },
    [autoModelEnabled, currentTeamId, haiku55Enabled, queryClient, resolveOption, surface, taskWriterAuto, userPreferences],
  );

  return { currentAiOption, setAiOption, usesPlanDefault, agentSessionAiOption };
}

let pendingThinkingWrite: Promise<unknown> = Promise.resolve();

export function useAiThinkingPreference() {
  const queryClient = useQueryClient();
  const { data: userPreferences } = useGetUserPreferences();
  const preference = parseAiThinkingPreference(userPreferences.aiModelPreferences?.thinking);

  const setPreference = useCallback(
    (update: Partial<TAiThinkingPreference>) => {
      const latest = queryClient.getQueryData<IUserPreferences>(USER_PREFERENCES_QUERY_KEY) ?? userPreferences;
      const next = {
        ...parseAiThinkingPreference(latest.aiModelPreferences?.thinking),
        ...update,
      };
      void queryClient.cancelQueries(
        { queryKey: USER_PREFERENCES_QUERY_KEY },
        { revert: false },
      );
      queryClient.setQueryData<IUserPreferences>(
        USER_PREFERENCES_QUERY_KEY,
        (previous) => ({
          ...(previous ?? userPreferences),
          aiModelPreferences: {
            ...(previous?.aiModelPreferences ?? userPreferences.aiModelPreferences),
            thinking: next,
          },
        }),
      );
      pendingThinkingWrite = pendingThinkingWrite
        .then(() => axios.post("/api/users/preferences", { aiThinkingPreference: next }))
        .catch((error) => {
          console.log("useAiThinkingPreference update error:", error);
        });
    },
    [queryClient, userPreferences],
  );

  return { preference, setPreference };
}
