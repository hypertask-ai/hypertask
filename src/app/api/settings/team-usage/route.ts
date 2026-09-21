import { NextResponse } from "next/server";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { gatewayBillingPeriodRange } from "../ai-usage/gatewayUsage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-team AI token usage for the current billing period, used to sort the
// Settings team switcher (most active team on top). Read straight from the
// AiUsage metering table via a single grouped query — cheap and indexed on
// [teamId, createdAt]. Scoped to the teams the caller can actually see.
export async function GET() {
  const user = await getServerCookieUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const teams = await prisma.team.findMany({
      where: {
        projects: {
          some: {
            status: "Normal",
            OR: [
              { ownerId: user.id },
              { members: { some: { userId: user.id } } },
            ],
          },
        },
      },
      select: { id: true },
    });

    const teamIds = teams.map((team) => team.id);
    if (teamIds.length === 0) {
      return NextResponse.json({ usage: {} });
    }

    const { startDate, endDate } = gatewayBillingPeriodRange();

    const rows = await prisma.aiUsage.groupBy({
      by: ["teamId"],
      where: {
        teamId: { in: teamIds },
        createdAt: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      },
      _sum: { totalTokens: true },
    });

    const usage: Record<string, number> = {};
    for (const row of rows) {
      if (row.teamId) usage[row.teamId] = row._sum.totalTokens ?? 0;
    }

    return NextResponse.json({ usage });
  } catch (error) {
    // Metering is best-effort; a failure here must never break the switcher.
    console.error("Error loading team usage:", error);
    return NextResponse.json({ usage: {} });
  }
}
