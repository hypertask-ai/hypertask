import { NextRequest, NextResponse } from "next/server";
import {
  getAccessibleAgentBoard,
  getAgentTeamIds,
  getBoardAgentMembers,
} from "@/utils/controllers/agents/boardMembers";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";
import { crossTeamAgentsEnabled } from "@/lib/agents/crossTeam";


export async function GET(request: NextRequest) {
  const userId = (await getSessionUser(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const projectIdNumber = Number(projectId);
  if (!Number.isInteger(projectIdNumber) || projectIdNumber < 1) {
    return NextResponse.json(
      { success: false, error: "Project ID is required" },
      { status: 400 }
    );
  }

  const project = await getAccessibleAgentBoard(projectIdNumber, userId);
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Board not found" },
      { status: 404 }
    );
  }

  const boardAgentRows = await getBoardAgentMembers(projectIdNumber, userId);
  const crossTeamEnabled = await crossTeamAgentsEnabled(userId);
  const teamIdByAgentId = crossTeamEnabled ? null : await getAgentTeamIds(
    boardAgentRows.map((row) => row.agent.id)
  );
  const provenance = !crossTeamEnabled && boardAgentRows.length > 0
    ? await prisma.agent.findMany({
        where: { id: { in: boardAgentRows.map((row) => row.agent.id) } },
        select: { id: true, crossTeamHomeTeamId: true },
      })
    : [];
  for (const agent of provenance) {
    if (agent.crossTeamHomeTeamId) teamIdByAgentId?.set(agent.id, agent.crossTeamHomeTeamId);
  }
  const agents = boardAgentRows
    .filter((row) => crossTeamEnabled
      ? row.status === "Accepted"
      : teamIdByAgentId?.get(row.agent.id) === project.teamId)
    .map((row) => {
      return {
        ...row.agent,
        userId: row.agent.userId,
        postsToImportant:
          (row.agent.permissions as AgentScopes | null)?.postsToImportant !== false,
      };
    });

  return NextResponse.json({ success: true, agents });
}
