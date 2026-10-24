import type { IUser } from "@/models/model";
import { Status } from "@prisma/client";
import { HTPR_7029_KEEP_DEMO_BOARD_ON_EMAIL_SIGNUP_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { adoptGuestBoards } from "@/utils/controllers/demo/adoptGuestBoards";
import { CompleteOnboardingFirstStepProvisioning } from "@/utils/controllers/users/completeOnboardingStep";

export async function provisionFirstWorkspace(
  user: IUser,
  previousSessionToken: string | undefined | null,
  teamTitle: string,
  boardTitle: string,
  companySize: string,
  companyRole: string,
  options: Parameters<typeof CompleteOnboardingFirstStepProvisioning>[5] & {
    keepDemoBoard?: boolean;
    onlyIfEmpty?: boolean;
  } = {},
) {
  const { keepDemoBoard: keepDemoBoardOverride, onlyIfEmpty, ...onboardingOptions } = options;
  const keepDemoBoard = keepDemoBoardOverride ?? await isFeatureEnabled(
    HTPR_7029_KEEP_DEMO_BOARD_ON_EMAIL_SIGNUP_FLAG,
    user.id,
  ).catch(() => false);

  if (keepDemoBoard && await adoptGuestBoards(previousSessionToken, user.id) > 0) {
    const Project = await prisma.project.findFirst({
      where: { ownerId: user.id, status: Status.Normal },
      include: { team: true },
    });
    if (!Project?.team) throw new Error("Adopted workspace not found");
    return { Project, Team: Project.team };
  }

  if (onlyIfEmpty) {
    const [ownedBoards, memberships] = await Promise.all([
      prisma.project.count({ where: { ownerId: user.id } }),
      prisma.member.count({ where: { userId: user.id } }),
    ]);
    if (ownedBoards > 0 || memberships > 0) return null;
  }

  return CompleteOnboardingFirstStepProvisioning(user, teamTitle, boardTitle, companySize, companyRole, onboardingOptions);
}
