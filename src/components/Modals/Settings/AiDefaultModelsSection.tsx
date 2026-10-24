"use client";

import AIModelDropDownButton from "@/components/Global/ModelSelectorDropdown";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import { aiModelOptions } from "@/lib/aiModelOptions";
import { type TAiModelPreferenceSurface } from "@/lib/aiModelPreferences";
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
          {DEFAULT_MODEL_ROWS.map((row) => (
            <DefaultModelRow key={row.surface} {...row} teamId={teamId} />
          ))}
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
