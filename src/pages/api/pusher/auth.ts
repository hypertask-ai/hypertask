import { withAgentScopeRequest } from "@/lib/auth/agentScope";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { NextApiRequest, NextApiResponse } from "next";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getRealtimeServer } from "@/lib/realtime/server";
import { featureFlagsChannel } from "@/lib/realtime/shared";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { extractBearerToken } from "@/lib/mcp/auth/session";
import { validateJwtToken } from "@/lib/mcp/auth/verifyJwt";
import { HTPR_7381_REALTIME_TOKEN_AUTH_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";

async function userMayAccess(
  channel: string,
  userId: number,
  actingAgentId: string | null,
): Promise<boolean> {
  if (channel === featureFlagsChannel()) return true;
  let m = /^private-project-(\d+)$/.exec(channel);
  if (m) {
    const access = await validateProjectAccess(Number(m[1]), userId, actingAgentId);
    return !access.error;
  }
  m = /^private-time-project-(\d+)$/.exec(channel);
  if (m) {
    const access = await validateProjectAccess(Number(m[1]), userId, actingAgentId);
    return !access.error;
  }
  m = /^private-(?:time-)?task-(\d+)$/.exec(channel);
  if (m) {
    const task = await prisma.task.findUnique({
      where: {
        id: Number(m[1]),
        project: getProjectWhere(userId, actingAgentId),
      },
      select: { projectId: true },
    });
    if (!task) return false;
    const access = await validateProjectAccess(task.projectId, userId, actingAgentId);
    return !access.error;
  }
  m = /^private-user-(\d+)$/.exec(channel);
  if (m) {
    return Number(m[1]) === userId;
  }
  return false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return withAgentScopeRequest(req, () => authorizeChannel(req, res));
}

async function authorizeChannel(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const socketId = req.body?.socket_id as string | undefined;
  const channel = req.body?.channel_name as string | undefined;
  if (!socketId || !channel) {
    return res.status(400).json({ error: "Missing socket_id or channel_name" });
  }

  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    let userId: number;
    if (session) {
      userId = session.userId;
    } else {
      const token = extractBearerToken(
        typeof req.headers.authorization === "string" ? req.headers.authorization : null
      );
      const ctx = token ? await validateJwtToken(token) : null;
      if (
        !ctx ||
        ctx.management ||
        !(await isFeatureEnabled(HTPR_7381_REALTIME_TOKEN_AUTH_FLAG, ctx.user.id))
      ) {
        return res.status(403).json({ error: "Not authenticated" });
      }
      userId = ctx.user.id;
    }

    const allowed = await userMayAccess(channel, userId, session.agentId ?? null);
    if (!allowed) {
      return res.status(403).json({ error: "No access to this channel" });
    }

    const server = getRealtimeServer();
    if (!server) {
      return res.status(503).json({ error: "Realtime not configured" });
    }

    const authResponse = server.authorizeChannel(socketId, channel);
    return res.status(200).json(authResponse);
  } catch (error) {
    console.error("[realtime] channel authorization failed", error);
    return res.status(500).json({ error: "Unable to authorize realtime channel" });
  }
}
