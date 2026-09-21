import { NextRequest, NextResponse } from "next/server";

import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { extraMinimalProjectWhere } from "@/utils/controllers/projects/getAllMinimal";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = await getAuthorizedTeam(request.nextUrl.searchParams.get("teamId"));
  if (access instanceof NextResponse) return access;

  const install = await prisma.slackInstall.findUnique({
    where: { teamId: access.teamId },
    select: {
      defaultProjectId: true,
      slackTeamId: true,
      slackTeamName: true,
    },
  });
  return NextResponse.json({ install });
}

export async function PATCH(request: NextRequest) {
  let body: { defaultProjectId?: unknown; teamId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const access = await getAuthorizedTeam(body.teamId);
  if (access instanceof NextResponse) return access;

  let defaultProjectId: number | null = null;
  if (body.defaultProjectId !== null) {
    defaultProjectId = Number(body.defaultProjectId);
    if (!Number.isSafeInteger(defaultProjectId) || defaultProjectId <= 0) {
      return NextResponse.json(
        { error: "Valid defaultProjectId required" },
        { status: 400 },
      );
    }
    const project = await prisma.project.findFirst({
      where: {
        AND: [
          extraMinimalProjectWhere(access.userId),
          { id: defaultProjectId, teamId: access.teamId },
        ],
      },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: "Project is not available to this team" },
        { status: 403 },
      );
    }
  }

  const install = await prisma.slackInstall.update({
    where: { teamId: access.teamId },
    data: { defaultProjectId },
    select: {
      defaultProjectId: true,
      slackTeamId: true,
      slackTeamName: true,
    },
  });
  return NextResponse.json({ install });
}

export async function DELETE(request: NextRequest) {
  let body: { teamId?: unknown };
  try {
    body = (await request.json()) as { teamId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const access = await getAuthorizedTeam(body.teamId);
  if (access instanceof NextResponse) return access;

  await prisma.slackInstall.deleteMany({ where: { teamId: access.teamId } });
  return NextResponse.json({ success: true });
}

async function getAuthorizedTeam(teamIdValue: unknown) {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const teamId = typeof teamIdValue === "string" ? teamIdValue.trim() : "";
  if (!teamId) {
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  }
  if (!(await hasTeamMembershipAccess(user.id, teamId))) {
    return NextResponse.json({ error: "Team access denied" }, { status: 403 });
  }
  return { teamId, userId: user.id };
}
