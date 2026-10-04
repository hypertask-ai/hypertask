import type { Prisma } from "@prisma/client";

import { decryptSecret } from "@/lib/crypto/byokCipher";
import prisma from "@/lib/prisma";
import { HTPR_6817_SLACK_APP_FLAG, isFeatureEnabled } from "@/lib/flags";
import { getRedis } from "@/lib/redis";
import { callSlackApi } from "@/lib/slack/api";

type SlackUserInfo = {
  is_email_confirmed?: boolean;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: { email?: string };
};

type SlackUserInfoResponse = {
  error?: string;
  ok: boolean;
  user?: SlackUserInfo;
};

export type SlackTeamMember = {
  email: string;
  id: number;
  verified: boolean;
};

const linkedUserSelect = {
  id: true,
  displayName: true,
  email: true,
  photoURL: true,
} satisfies Prisma.UserSelect;

export type LinkedSlackUser = Prisma.UserGetPayload<{
  select: typeof linkedUserSelect;
}>;

export type SlackActor = {
  botToken: string;
  installId: string;
  slackTeamId: string;
  slackUserId: string;
  teamAiProviderSettings: unknown;
  teamId: string;
  user: LinkedSlackUser;
};

export function selectConfirmedUniqueTeamMember(
  slackUser: SlackUserInfo | null | undefined,
  teamMembers: SlackTeamMember[],
): SlackTeamMember | null {
  if (slackUser?.is_email_confirmed !== true) return null;
  const slackEmail = slackUser.profile?.email?.trim().toLowerCase();
  if (!slackEmail) return null;
  const matches = teamMembers.filter(
    (member) =>
      member.verified && member.email.trim().toLowerCase() === slackEmail,
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function isSlackInstallTeamMember(
  installId: string,
  userId: number,
): Promise<boolean> {
  const install = await prisma.slackInstall.findFirst({
    where: {
      id: installId,
      team: {
        OR: [
          { googleAccount: { is: { userId } } },
          { members: { some: { userId, status: "Accepted" } } },
        ],
      },
    },
    select: { id: true },
  });
  return Boolean(install);
}

export async function resolveSlackActor(
  slackTeamId: string,
  slackUserId: string,
): Promise<SlackActor | null> {
  const install = await prisma.slackInstall.findUnique({
    where: { slackTeamId },
    select: {
      encryptedBotToken: true,
      id: true,
      installedByUserId: true,
      slackTeamId: true,
      teamId: true,
      team: { select: { aiProviderSettings: true } },
      userLinks: {
        where: { slackUserId },
        select: { user: { select: linkedUserSelect } },
        take: 1,
      },
    },
  });
  if (!install) return null;

  const botToken = decryptSecret(install.encryptedBotToken);
  let user: LinkedSlackUser | null = install.userLinks[0]?.user ?? null;
  const disconnectedUserId = await getSlackAutoLinkDisabledUserId(install.id, slackUserId);
  const slackAppEnabled = await isFeatureEnabled(
    HTPR_6817_SLACK_APP_FLAG,
    disconnectedUserId ?? user?.id ?? install.installedByUserId,
  );
  // The link is gone after disconnect, so the marker owns the rollout identity.
  if (disconnectedUserId && slackAppEnabled) return null;
  if (user && !(await isSlackInstallTeamMember(install.id, user.id))) {
    await prisma.slackUserLink.deleteMany({
      where: { installId: install.id, slackUserId },
    });
    user = null;
  }

  if (!user) {
    const [slackResult, teamMembers] = await Promise.all([
      callSlackApi<SlackUserInfoResponse>("users.info", botToken, {
        user: slackUserId,
      }).catch(() => null),
      listSlackInstallTeamMembers(install.teamId),
    ]);
    const match = selectConfirmedUniqueTeamMember(
      slackAppEnabled && (slackResult?.user?.is_bot || slackResult?.user?.deleted)
        ? null
        : slackResult?.user,
      teamMembers,
    );
    if (match) {
      try {
        const link = await prisma.slackUserLink.create({
          data: {
            installId: install.id,
            slackUserId,
            userId: match.id,
          },
          select: { user: { select: linkedUserSelect } },
        });
        user = link.user;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const concurrentLink = await prisma.slackUserLink.findUnique({
          where: {
            installId_slackUserId: { installId: install.id, slackUserId },
          },
          select: { user: { select: linkedUserSelect } },
        });
        user = concurrentLink?.user ?? null;
      }
    }
  }

  if (slackAppEnabled && user && !(await isSlackInstallTeamMember(install.id, user.id))) {
    return null;
  }
  return user
    ? {
        botToken,
        installId: install.id,
        slackTeamId: install.slackTeamId,
        slackUserId,
        teamAiProviderSettings: install.team.aiProviderSettings,
        teamId: install.teamId,
        user,
      }
    : null;
}

function slackAutoLinkDisabledKey(installId: string, slackUserId: string): string {
  return `slack:disconnected:${installId}:${slackUserId}`;
}

export async function getSlackAutoLinkDisabledUserId(
  installId: string,
  slackUserId: string,
): Promise<number | null> {
  const redis = await getRedis();
  const userId = Number(await redis.get(slackAutoLinkDisabledKey(installId, slackUserId)));
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export async function setSlackAutoLinkDisabled(
  installId: string,
  slackUserId: string,
  userId: number | null,
): Promise<void> {
  const redis = await getRedis();
  const key = slackAutoLinkDisabledKey(installId, slackUserId);
  if (userId !== null) await redis.set(key, String(userId));
  else await redis.del(key);
}

async function listSlackInstallTeamMembers(
  teamId: string,
): Promise<SlackTeamMember[]> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      members: {
        where: { status: "Accepted" },
        select: {
          user: {
            select: {
              id: true,
              email: true,
              emailVerified: true,
              UserSetting: { select: { isVerified: true } },
            },
          },
        },
      },
    },
  });
  if (!team) return [];

  const owner = await prisma.user.findUnique({
    where: { id: team.googleAccount.userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      UserSetting: { select: { isVerified: true } },
    },
  });
  return [
    ...new Map(
      [owner, ...team.members.map((member) => member.user)]
        .filter((member): member is NonNullable<typeof member> => Boolean(member))
        .map((member) => [
          member.id,
          {
            email: member.email,
            id: member.id,
            verified:
              member.emailVerified || member.UserSetting?.isVerified === true,
          },
        ]),
    ).values(),
  ];
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "P2002",
  );
}
