import prisma from "@/lib/prisma";
import type { AgentRole } from "@/lib/mcp/agents/scopes";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";

export async function changeTeamAgentRole(
  userId: number,
  teamId: string,
  agentId: string,
  role: AgentRole,
) {
  return prisma.$transaction(async (tx) => {
    const team = await tx.team.findFirst({
      where: { id: teamId, googleAccount: { is: { userId } } },
      select: { id: true },
    });
    if (!team) {
      return { ok: false as const, status: 403, error: "Only the team owner can change agent roles" };
    }

    const agent = await tx.agent.findFirst({
      where: {
        id: agentId,
        ...boardAgentVisibilityWhere(userId),
        members: {
          some: { project: { teamId } },
          every: { project: { OR: [{ teamId }, { teamId: null }] } },
        },
      },
      select: { id: true, runtimeType: true },
    });
    if (!agent) {
      return { ok: false as const, status: 404, error: "Agent does not exist in this team" };
    }

    if (agent.runtimeType === "NATIVE") {
      return { ok: false as const, status: 400, error: "This agent's role cannot be changed yet" };
    }

    await tx.$executeRaw`
      UPDATE "Agent"
      SET "permissions" = (CASE WHEN jsonb_typeof("permissions") = 'object' THEN "permissions" ELSE '{}'::jsonb END) || jsonb_build_object('role', ${role}::text)
      WHERE "id" = ${agent.id}
    `;
    return { ok: true as const, agent: { id: agent.id, role } };
  });
}
