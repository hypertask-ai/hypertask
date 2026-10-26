import prisma from "@/lib/prisma";
import {
  aiModelOptions,
  isAiModelOptionVisible,
  getAiModelOptionById,
  getAiModelDefinition,
  pickReplacementAiModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { resolveTeamProviderEnabled } from "@/lib/aiProviders";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export function filterModelOptionForTeam(
  option: TAiModelOption,
  settings: unknown,
  haiku55Enabled = false,
): TAiModelOption {
  option = getAiModelOptionById(option.id, haiku55Enabled) ?? option;
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
      isAiModelOptionVisible(candidate, haiku55Enabled, false, true) && candidateDefinition &&
      candidateDefinition.provider !== "custom" &&
      resolveTeamProviderEnabled(settings, candidateDefinition.provider)
    );
  });

  const fallback = pickReplacementAiModelOption(option.modelKey, enabled, haiku55Enabled);

  if (!fallback) throw new Error("No AI providers are enabled for this team");
  return fallback;
}

export async function getProjectTeamProviderContext(
  projectId: number | null | undefined,
  userId: number | null | undefined,
  agentId?: string | null,
  teamScope?: import("@/lib/mcp/auth/types").AgentTokenTeamScope | null,
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
      ...taskWriteAccessWhere(userId, agentId, teamScope),
    },
    select: {
      id: true,
      teamId: true,
      team: { select: { aiProviderSettings: true } },
    },
  });

  if (teamScope != null && !project) throw new Error("Project not found or access denied");
  return {
    projectId: project?.id ?? null,
    teamId: project?.teamId ?? null,
    settings: project?.team?.aiProviderSettings,
  };
}
