import prisma from "@/lib/prisma";
import {
  aiModelOptions,
  getAiModelDefinition,
  pickReplacementAiModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function filterModelOptionForTeam(
  option: TAiModelOption,
  settings: unknown
): TAiModelOption {
  const definition = getAiModelDefinition(option.modelKey);
  if (
    !definition ||
    definition.provider === "custom" ||
    resolveTeamProviderEnabled(settings, definition.provider)
  ) {
    return option;
  }

  const enabled = aiModelOptions.filter((candidate) => {
    const candidateDefinition = getAiModelDefinition(candidate.modelKey);
    return (
      candidateDefinition &&
      candidateDefinition.provider !== "custom" &&
      resolveTeamProviderEnabled(settings, candidateDefinition.provider)
    );
  });

  const fallback = pickReplacementAiModelOption(option.modelKey, enabled);

  if (!fallback) throw new Error("No AI providers are enabled for this team");
  return fallback;
}

export async function getProjectTeamProviderContext(
  projectId: number | null | undefined,
  userId: number | null | undefined
): Promise<{
  projectId: number | null;
  teamId: string | null;
  settings: unknown;
}> {
  if (!projectId || !userId) {
    return { projectId: null, teamId: null, settings: undefined };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      // Platform-funded inference requires write-capable board membership.
      // Public/share-only content access must never bill the owning team.
      ...taskWriteAccessWhere(userId),
    },
    select: {
      id: true,
      teamId: true,
      team: { select: { aiProviderSettings: true } },
    },
  });

  return {
    projectId: project?.id ?? null,
    teamId: project?.teamId ?? null,
    settings: project?.team?.aiProviderSettings,
  };
}
