import type { NextApiRequest, NextApiResponse } from "next";
import { isValidUser } from "@/utils/edgeHelpers";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getRealtimeServer } from "@/lib/realtime/server";
import prisma from "@/lib/prisma";

// Authorizes a client to subscribe to a private realtime channel.
// Three channel shapes, each with its own access check:
//   private-project-<id> : user must have access to the board
//   private-task-<id>    : user must have access to the task's board
//   private-time-task-<id> / private-time-project-<id> : same checks, timer feed
//   private-user-<id>    : must be that user's own channel
async function userMayAccess(
  channel: string,
  userId: number
): Promise<boolean> {
  let m = /^private-project-(\d+)$/.exec(channel);
  if (m) {
    const access = await validateProjectAccess(Number(m[1]), userId, null);
    return !access.error;
  }
  m = /^private-time-project-(\d+)$/.exec(channel);
  if (m) {
    const access = await validateProjectAccess(Number(m[1]), userId, null);
    return !access.error;
  }
  m = /^private-(?:time-)?task-(\d+)$/.exec(channel);
  if (m) {
    const task = await prisma.task.findUnique({
      where: { id: Number(m[1]) },
      select: { projectId: true },
    });
    if (!task) return false;
    const access = await validateProjectAccess(task.projectId, userId, null);
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { user, isValid } = isValidUser(req.cookies.nookies_user);
  if (!isValid || !user) {
    return res.status(403).json({ error: "Not authenticated" });
  }

  const socketId = req.body?.socket_id as string | undefined;
  const channel = req.body?.channel_name as string | undefined;
  if (!socketId || !channel) {
    return res.status(400).json({ error: "Missing socket_id or channel_name" });
  }

  const allowed = await userMayAccess(channel, Number(user.id));
  if (!allowed) {
    return res.status(403).json({ error: "No access to this channel" });
  }

  const server = getRealtimeServer();
  if (!server) {
    return res.status(503).json({ error: "Realtime not configured" });
  }

  const authResponse = server.authorizeChannel(socketId, channel);
  return res.status(200).json(authResponse);
}
