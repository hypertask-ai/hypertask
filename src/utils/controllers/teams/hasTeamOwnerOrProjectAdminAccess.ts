import prisma from "@/lib/prisma";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";

// Shared by settings routes that should be visible to the team owner or an
// admin of a project on that team (billing, AI usage). A project admin may
// view/edit these settings; only the team owner may mutate anything more
// sensitive (e.g. the Stripe subscription itself).
const hasTeamOwnerOrProjectAdminAccess = async (
  userId: number,
  userAccountId: string | undefined,
  team: { googleAccount: { userId: number }; googleAccountId: string | null },
  teamId: string,
  projectId: string | null
): Promise<boolean> => {
  const isOwner =
    team.googleAccount.userId === userId ||
    Boolean(userAccountId && userAccountId === team.googleAccountId);

  if (isOwner) return true;
  if (!projectId) return false;

  const project = await prisma.project.findUnique({
    where: { id: parseInt(projectId) },
    select: { teamId: true },
  });
  if (project?.teamId !== teamId) return false;

  return isProjectAdmin(userId, parseInt(projectId));
};

export default hasTeamOwnerOrProjectAdminAccess;
