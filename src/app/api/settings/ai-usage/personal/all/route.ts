import { NextResponse } from "next/server";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { computePersonalTeamSharePct } from "../../gatewayUsage";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { teamAiAllowanceUsd } from "@/lib/aiAllowancePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PersonalAiUsageAllResponse = {
  teams: Array<{
    teamId: string;
    teamName: string;
    fundingSource: "customer" | "managed" | "shared" | null;
    memberCount: number;
    userSharePct: number;
    resetsOn: string;
  }>;
};

export async function GET() {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const teams = await prisma.team.findMany({
    where: {
      // A team with no live boards is effectively archived - hide it.
      projects: { some: { status: "Normal" } },
      OR: [
        { googleAccount: { userId: user.id } },
        { members: { some: { userId: user.id, status: "Accepted" } } },
        // Never pass undefined into an OR branch: Prisma treats it as
        // no-filter and the branch would match every team.
        ...(user.accountId ? [{ googleAccountId: user.accountId }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      googleAccountId: true,
      googleAccount: { select: { userId: true } },
      members: {
        where: { status: "Accepted" },
        select: { userId: true },
      },
    },
  });
  const accessibleTeams = teams.filter(
    (team) =>
      team.googleAccount.userId === user.id ||
      Boolean(user.accountId && user.accountId === team.googleAccountId) ||
      team.members.some((member) => member.userId === user.id),
  );
  const now = new Date();
  const resetsOn = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10);
  const teamUsage = await Promise.all(
    accessibleTeams.map(async (team) => {
      const memberIds = Array.from(
        new Set([
          team.googleAccount.userId,
          ...team.members.map((member) => member.userId),
        ]),
      );
      let funding: Awaited<ReturnType<typeof getTeamGatewayFunding>>;

      try {
        funding = await getTeamGatewayFunding({ trustedTeamId: team.id });
      } catch (error) {
        console.error(
          `Error resolving AI Gateway key for team ${team.id}:`,
          error,
        );
      }

      const usage = await computePersonalTeamSharePct({
        allowanceUsd: teamAiAllowanceUsd(
          await storePlanIdForProject(null, team.id),
        ),
        gatewayKey:
          funding?.source === "customer" ? null : (funding?.apiKey ?? null),
        memberIds,
        teamId: team.id,
        userId: user.id,
      });

      return {
        teamId: team.id,
        teamName: team.title ?? "Untitled team",
        fundingSource: funding?.source ?? null,
        memberCount: usage.memberCount,
        userSharePct: usage.userSharePct,
        resetsOn,
      };
    }),
  );

  return NextResponse.json({
    teams: teamUsage,
  } satisfies PersonalAiUsageAllResponse);
}
