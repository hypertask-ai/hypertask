// hooks/General/useAIResponseHandler.ts
import { currentProjectAtom } from '@/store';
import { useState, useCallback } from 'react';
import { useRecoilState } from '@/lib/state';
import { useGetUserPreferences } from '@/hooks/General/useGetUserPreferences';
import {
  defaultAiModelOption,
  getAiModelOptionById,
} from '@/lib/aiModelOptions';
import { getAiModelPreferenceIds } from '@/lib/aiModelPreferences';

export const useAIResponseHandler = (defaultMode: string, flaskUrl: string) => {
  const [currentProject] = useRecoilState(currentProjectAtom);
  const { data: userPreferences } = useGetUserPreferences();
  const [isLoading, setLoading] = useState(false);
  const [aiResponse, setAIResponse] = useState("");
  const improveWritingOptionIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    "improveWriting",
    currentProject?.teamId,
  );
  const improveWritingOption =
    getAiModelOptionById(improveWritingOptionIds.teamScoped) ??
    getAiModelOptionById(improveWritingOptionIds.global);
  const improveWritingModel =
    improveWritingOption?.id ??
    currentProject?.ai_custom_instructions?.[0]?.model_selected ??
    defaultAiModelOption.id;
  const improveWritingSource =
    improveWritingOption?.source ??
    currentProject?.ai_custom_instructions?.[0]?.source_selected ??
    defaultAiModelOption.source;

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
