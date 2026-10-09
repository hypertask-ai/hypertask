import { deriveCurrentBoardBilling } from "@/lib/deriveCurrentBoardBilling";
import { hasHaikuByokProviderFlags } from "@/lib/byokSelectedProviderGate";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7038_HAIKU_DEFAULT_FLAG, HTPR_7010_HAIKU_5_5_FLAG, LUNA_FREE_PLAN_FLAG } from "@/lib/flags/keys";
// hooks/General/useAIResponseHandler.ts
import { currentProjectAtom } from '@/store';
import { useState, useCallback } from 'react';
import { useRecoilState } from '@/lib/state';
import { useGetUserPreferences } from '@/hooks/General/useGetUserPreferences';
import {
  defaultAiModelOption,
  getDefaultAiModelOptionForPlan,
  getAiModelOptionById,
} from '@/lib/aiModelOptions';
import { getAiModelPreferenceIds } from '@/lib/aiModelPreferences';

export const useAIResponseHandler = (defaultMode: string, flaskUrl: string) => {
  const [currentProject] = useRecoilState(currentProjectAtom);
  const { data: userPreferences } = useGetUserPreferences();
  const haikuDefaultEnabled = useFlag(HTPR_7038_HAIKU_DEFAULT_FLAG);
  const haiku55Enabled = useFlag(HTPR_7010_HAIKU_5_5_FLAG) || haikuDefaultEnabled;
  const lunaFree = useFlag(LUNA_FREE_PLAN_FLAG) || haikuDefaultEnabled;
  const defaultBilling = deriveCurrentBoardBilling(currentProject);
  const defaultModelOption = haikuDefaultEnabled || haiku55Enabled
    ? getDefaultAiModelOptionForPlan(defaultBilling?.storePlanId, hasHaikuByokProviderFlags(defaultBilling?.byokProviderFlags), lunaFree, true, haikuDefaultEnabled)
    : defaultAiModelOption;
  const [isLoading, setLoading] = useState(false);
  const [aiResponse, setAIResponse] = useState("");
  const improveWritingOptionIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    "improveWriting",
    currentProject?.teamId,
  );
  const improveWritingOption =
    getAiModelOptionById(improveWritingOptionIds.teamScoped, haiku55Enabled) ??
    getAiModelOptionById(improveWritingOptionIds.global, haiku55Enabled) ??
    (haiku55Enabled ? getAiModelOptionById(currentProject?.ai_custom_instructions?.[0]?.model_selected, true) : undefined);
  const improveWritingModel =
    improveWritingOption?.id ??
    currentProject?.ai_custom_instructions?.[0]?.model_selected ??
    defaultModelOption.id;
  const improveWritingSource =
    improveWritingOption?.source ??
    currentProject?.ai_custom_instructions?.[0]?.source_selected ??
    defaultModelOption.source;

  const handleAIResponse = useCallback(async (prompt: string, additionalContext: string) => {
    setLoading(true);
    setAIResponse("");
    try {
      const response = await fetch(flaskUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: currentProject?.id,
          teamId: currentProject?.teamId,
          PROMPT: additionalContext + '\n' + prompt,
          customInstructions: currentProject?.ai_custom_instructions?.[0]?.customInstruction ?? "",
          sourceSelected: improveWritingSource,
          modelSelected: improveWritingModel,
          modelOptionId: improveWritingModel,
          aiMode: defaultMode,
        }),
      });

      const reader = response?.body?.getReader();
      const decoder = new TextDecoder();
      while (true && reader) {
        const { done, value } = await reader.read();
        if (done) break;
        setAIResponse(prev => prev + decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      console.error("AI Response Error:", error);
    } finally {
      setLoading(false);
    }
  }, [defaultMode, currentProject, flaskUrl, improveWritingModel, improveWritingSource]);

  return { isLoading, aiResponse, handleAIResponse };
};
