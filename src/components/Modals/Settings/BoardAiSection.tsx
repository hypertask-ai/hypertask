"use client";

import { PropsWithChildren, useEffect, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import AICustomPromptInput from "@/components/Modals/AICustomPrompt/AICustomPromptInput";
import ActionRow from "@/components/Modals/AICustomPrompt/ActionRow";
import { CustomAiProvider } from "@/lib/contexts/Multipages/customAiInstructionContext";
import { currentProjectAtom } from "@/store";
import type { IAiCustomInstructions } from "@/models/model";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import SettingsSectionShell from "./SettingsSectionShell";
import { useSettingsTeam } from "./useSettingsTeam";

const BoardAiContent = () => {
  const { project } = useSettingsTeam();

  if (!project) return null;

  return (
    <SettingsSectionShell fullHeight title="Custom instructions">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="px-2 text-dense font-medium text-text-light-gray">
          Guide AI behavior for {project.title ?? project.name}.
        </p>
        <AICustomPromptInput fillHeight />
        <ActionRow />
      </div>
    </SettingsSectionShell>
  );
};

export const BoardAiSettingsProvider = ({
  children,
}: PropsWithChildren) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const setCurrentProject = useSetRecoilState(currentProjectAtom);
  const { project } = useSettingsTeam();
  const board = project;
  const boardId = board?.id;
  const [syncedBoardId, setSyncedBoardId] = useState<number | null>(null);
  const {
    data: customInstructions,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ["board-ai-custom-instructions", boardId],
    queryFn: async () => {
      const response = await axios.get<IAiCustomInstructions | null>(
        "/api/ai/project/customInstruction",
        { params: { projectId: boardId } },
      );
      return response.data;
    },
    enabled: Boolean(boardId),
  });

  useEffect(() => {
    if (project && currentProject?.id !== project.id) setCurrentProject(project);
  }, [currentProject, project, setCurrentProject]);

  useEffect(() => {
    if (!boardId || (customInstructions === undefined && !isError)) return;

    setCurrentProject((previous) =>
      previous?.id === boardId && customInstructions !== undefined
        ? {
            ...previous,
            ai_custom_instructions: customInstructions
              ? [customInstructions]
              : [],
          }
        : previous,
    );
    setSyncedBoardId(boardId);
  }, [boardId, customInstructions, isError, setCurrentProject]);

  if (
    !board ||
    currentProject?.id !== board.id ||
    isLoading ||
    syncedBoardId !== board.id
  ) {
    return null;
  }

  return (
    <CustomAiProvider
      key={board.id}
      closeHandler={() => undefined}
      projectId={board.id}
    >
      {children}
    </CustomAiProvider>
  );
};

const BoardAiSection = () => (
  <BoardAiSettingsProvider>
    <BoardAiContent />
  </BoardAiSettingsProvider>
);

export default BoardAiSection;
