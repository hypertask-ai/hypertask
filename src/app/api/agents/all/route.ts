import { NextRequest, NextResponse } from "next/server";
import {
  getAccessibleAgentBoard,
  getAgentTeamIds,
  getBoardAgentMembers,
} from "@/utils/controllers/agents/boardMembers";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { getSessionUser } from "@/lib/auth/getSessionUser";


/** Returns agents explicitly added to the board via Member.agentId. */
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
  const teamIdByAgentId = await getAgentTeamIds(
    boardAgentRows.map((row) => row.agent.id)
  );
  const agents = boardAgentRows
    .filter((row) => teamIdByAgentId.get(row.agent.id) === project.teamId)
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
