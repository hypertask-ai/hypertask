"use client";

import type { ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { ChevronDown } from "lucide-react";
import AIModelDropDownButton from "@/components/Global/ModelSelectorDropdown";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import {
  USER_PREFERENCES_QUERY_KEY,
  useGetUserPreferences,
  type IUserPreferences,
} from "@/hooks/General/useGetUserPreferences";
import {
  aiImageModelDefinitions,
  aiModelOptions,
  resolveAiImageModelMention,
} from "@/lib/aiModelOptions";
import {
  getAiModelPreferenceIds,
  mergeAiModelPreferenceUpdates,
  type TAiModelPreferenceSurface,
} from "@/lib/aiModelPreferences";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const DEFAULT_MODEL_ROWS: Array<{
  description: string;
  label: string;
  surface: TAiModelPreferenceSurface;
}> = [
  {
    surface: "aiChat",
    label: "AI chat",
    description: "The model used for AI conversations.",
  },
  {
    surface: "taskWriter",
    label: "Task writer",
    description: "The model used to draft tasks.",
  },
  {
    surface: "writeWithAi",
    label: "Write with AI",
    description: "The model used to write task content.",
  },
  {
    surface: "improveWriting",
    label: "Improve writing",
    description: "The model used by slash commands and editor improve actions.",
  },
  {
    surface: "askAi",
    label: "Ask AI (search)",
    description: "The model used to answer search questions.",
  },
  {
    surface: "imageGeneration",
    label: "Image generation",
    description: "The image model used when HyperAI generates images.",
  },
];

const DefaultModelRow = ({
  description,
  label,
  surface,
  teamId,
}: (typeof DEFAULT_MODEL_ROWS)[number] & { teamId: string | null }) => {
  const { currentAiOption, setAiOption } = useAiModelPreference(surface, {
    includeBoardFallback: false,
    teamId,
  });

  return (
    <div className="flex flex-col gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-white-black">{label}</p>
        <p className="text-text-light-gray">{description}</p>
      </div>
      <div className="w-full shrink-0 sm:w-[230px]">
        <AIModelDropDownButton
          aiSelected={currentAiOption}
          currentOptions={aiModelOptions}
          dropDownClassName="justify-between"
          modelTeamId={teamId}
          optionCallback={setAiOption}
          respectTeamAvailability={false}
          stackSubmenus
        />
      </div>
    </div>
  );
};

const AiDefaultModelsSection = () => {
  const { team, teamId } = useSettingsTeam();
  const teamTitle = team?.title;
  const queryClient = useQueryClient();
  const { data: userPreferences } = useGetUserPreferences();
  const imagePreferenceIds = getAiModelPreferenceIds(
    userPreferences.aiModelPreferences,
    "imageGeneration",
    teamId,
  );
  const preferredImageModelKey =
    resolveAiImageModelMention(imagePreferenceIds.teamScoped)?.key ??
    resolveAiImageModelMention(imagePreferenceIds.global)?.key ??
    "nano-banana";

  const updateImageModel = (event: ChangeEvent<HTMLSelectElement>) => {
    const imageModel = aiImageModelDefinitions.find(
      (model) => model.key === event.target.value,
    );
    if (!imageModel) return;

    if (!teamId) return;

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
          { imageGeneration: imageModel.key },
          teamId,
        ),
      }),
    );

    void axios
      .post("/api/users/preferences", {
        aiModelPreferences: { imageGeneration: imageModel.key },
        aiModelPreferencesTeamId: teamId,
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
        console.log("imageGeneration preference update error:", error);
      });
  };

  return (
    <SettingsSectionShell
      description={
        teamTitle
          ? `Defaults for ${teamTitle}. Other teams have their own.`
          : undefined
      }
      title="Default models"
    >
      <SettingsCard title="AI functions">
        <div className="flex flex-col">
          {DEFAULT_MODEL_ROWS.map((row) =>
            row.surface === "imageGeneration" ? (
              <div
                key={row.surface}
                className="flex flex-col gap-3 border-b border-border-light-gray-thin px-2 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-white-black">{row.label}</p>
                  <p className="text-text-light-gray">{row.description}</p>
                </div>
                <div className="relative w-full shrink-0 sm:w-[230px]">
                  <select
                    aria-label="Default image generation model"
                    className="w-full appearance-none rounded-[4px] bg-active-modal-element px-2 py-1 pr-8 text-dense leading-normal text-white-black shadow-[0_6px_20px_rgba(0,0,0,0.22)] outline-none transition-colors hover:bg-hoverCardBackground"
                    onChange={updateImageModel}
                    value={preferredImageModelKey}
                  >
                    {aiImageModelDefinitions.map((model) => (
                      <option key={model.key} value={model.key}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-light-gray"
                    size={16}
                    strokeWidth={1.75}
                  />
                </div>
              </div>
            ) : (
              <DefaultModelRow key={row.surface} {...row} teamId={teamId} />
            ),
          )}
        </div>
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Choosing a model inside a feature also updates that feature&apos;s
          default.
        </p>
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default AiDefaultModelsSection;
