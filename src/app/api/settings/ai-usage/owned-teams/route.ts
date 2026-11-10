import { NextResponse } from "next/server";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7788_TEAM_AI_BREAKDOWN_FLAG } from "@/lib/flags/definitions/htpr-7788-team-ai-breakdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!(await isFeatureEnabled(HTPR_7788_TEAM_AI_BREAKDOWN_FLAG, user.id))) return NextResponse.json({ teams: [] });

  const teams = await prisma.team.findMany({
    where: {
      projects: { some: { status: "Normal" } },
      OR: [
        { googleAccount: { userId: user.id } },
        ...(user.accountId ? [{ googleAccountId: user.accountId }] : []),
      ],
    },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
  const owned = teams.map((team) => ({
    teamId: team.id,
    teamName: team.title ?? "Untitled team",
  }));

  return NextResponse.json({ teams: owned });
}
