"use client";

import AiCustomInstructionsFileContainer from "@/components/Modals/AICustomPrompt/AiCustomInstructionsFileContainer";
import { BoardAiSettingsProvider } from "./BoardAiSection";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const BoardFilesContent = () => {
  const { project } = useSettingsTeam();

  if (!project) return null;

  return (
    <SettingsSectionShell title="Files">
      <AiCustomInstructionsFileContainer
        RAGFiles={
          project.ai_custom_instructions?.[0]?.attachments ?? []
        }
      />
    </SettingsSectionShell>
  );
};

export default function BoardFilesSection() {
  return (
    <BoardAiSettingsProvider>
      <BoardFilesContent />
    </BoardAiSettingsProvider>
  );
}
