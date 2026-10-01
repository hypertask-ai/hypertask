import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { getTeamAgentPresence } from "@/lib/mcp/agents/presence";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createAgentPresenceTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_agent_presence: tool({
      description:
        "Show live agent status and current work for a team the current user belongs to or owns.",
      inputSchema: z.object({
        team_id: z.string().min(1),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_agent_presence");
        const teamId = input.team_id.trim();
        if (!teamId) {
          return { success: false, error: "team_id is required" };
        }

        const [dbUser, team] = await Promise.all([
          prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, accountId: true },
          }),
          prisma.team.findUnique({
            where: { id: teamId },
            select: { id: true, googleAccountId: true },
          }),
        ]);
        if (!dbUser) {
          return { success: false, error: "User not found" };
        }
        if (!team) {
          return { success: false, error: "Team not found" };
        }

        const membership = await prisma.member_Team.findFirst({
          where: {
            userId: user.id,
            teamId: team.id,
            status: "Accepted",
          },
          select: { id: true },
        });
        const ownsTeam =
          dbUser.accountId != null && dbUser.accountId === team.googleAccountId;
        if (!membership && !ownsTeam) {
          return {
            success: false,
            error: "User cannot view agent presence for this team",
          };
        }

        const agents = await getTeamAgentPresence(team.id);
        return sanitizeForJson({ success: true, agents });
      }),
    }),
  };
}
