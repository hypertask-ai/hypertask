import { NextResponse } from "next/server";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { computePersonalTeamSharePct } from "../gatewayUsage";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { teamAiAllowanceUsd } from "@/lib/aiAllowancePolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const displayNameForUser = (user: {
  displayName: string | null;
  email: string;
  id: number;
}) => user.displayName?.trim() || user.email || `User ${user.id}`;

export async function GET(request: Request) {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const teamId = new URL(request.url).searchParams.get("teamId")?.trim();
  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      googleAccountId: true,
      members: {
        where: { status: "Accepted" },
        select: { userId: true },
      },
    },
  });

  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const isOwner =
    team.googleAccount.userId === user.id ||
    Boolean(user.accountId && user.accountId === team.googleAccountId);
  const isMember = team.members.some((member) => member.userId === user.id);
  if (!isOwner && !isMember) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const memberIds = Array.from(
    new Set([
      team.googleAccount.userId,
      ...team.members.map((member) => member.userId),
    ]),
  );
  const users = isOwner
    ? await prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { displayName: true, email: true, id: true },
      })
    : [];
  const funding = await getTeamGatewayFunding({ trustedTeamId: teamId });
  const usage = await computePersonalTeamSharePct({
    allowanceUsd: teamAiAllowanceUsd(
      await storePlanIdForProject(null, teamId),
    ),
    gatewayKey: funding?.source === "customer" ? null : (funding?.apiKey ?? null),
    memberIds,
    members: isOwner
      ? users.map((member) => ({
          displayName: displayNameForUser(member),
          userId: member.id,
        }))
      : undefined,
    teamId,
    userId: user.id,
  });

  return NextResponse.json({
    ...usage,
    fundingSource: funding?.source ?? null,
  });
}
