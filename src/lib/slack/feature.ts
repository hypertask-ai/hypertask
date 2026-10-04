import { HTPR_6817_SLACK_APP_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { getSlackAutoLinkDisabledUserId, resolveSlackActor } from "@/lib/slack/userLink";

export async function isSlackAppEnabled(
  slackTeamId: string,
  slackUserId?: string,
): Promise<boolean> {
  const install = await prisma.slackInstall.findUnique({
    where: { slackTeamId },
    select: {
      id: true,
      installedByUserId: true,
      userLinks: {
        where: { slackUserId: slackUserId ?? "" },
        select: { userId: true },
        take: 1,
      },
    },
  });
  if (!install) return false;
  const linkedUserId = install.userLinks[0]?.userId;
  if (linkedUserId) return isFeatureEnabled(HTPR_6817_SLACK_APP_FLAG, linkedUserId);
  const installEnabled = await isFeatureEnabled(HTPR_6817_SLACK_APP_FLAG, install.installedByUserId);
  if (!slackUserId) return installEnabled;
  const disconnectedUserId = await getSlackAutoLinkDisabledUserId(install.id, slackUserId);
  if (disconnectedUserId) return isFeatureEnabled(HTPR_6817_SLACK_APP_FLAG, disconnectedUserId);
  // Resolve first-contact matches before choosing behavior, not after an action.
  const actor = await resolveSlackActor(slackTeamId, slackUserId);
  return actor
    ? isFeatureEnabled(HTPR_6817_SLACK_APP_FLAG, actor.user.id)
    : installEnabled;
}
