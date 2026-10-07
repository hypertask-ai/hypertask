import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const parseTaskId = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const taskId = Number(value);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userId = session.userId;

  try {
    if (req.method === "GET") {
      const taskId = parseTaskId(req.query.taskId);
      if (!taskId) {
        return res.status(400).json({ message: "Invalid task ID" });
      }

      const taskMute = await prisma.taskMute.findUnique({
        where: { taskId_userId: { taskId, userId: userId } },
        select: { id: true },
      });

      return res.status(200).json({ muted: Boolean(taskMute) });
    }

    const taskId = parseTaskId(req.body?.taskId);
    const muted = req.body?.muted;
    if (!taskId || typeof muted !== "boolean") {
      return res.status(400).json({ message: "Invalid mute preference" });
    }

    if (muted) {
      await prisma.taskMute.upsert({
        where: { taskId_userId: { taskId, userId: userId } },
        update: {},
        create: { taskId, userId: userId },
      });
    } else {
      await prisma.taskMute.deleteMany({
        where: { taskId, userId: userId },
      });
    }

    return res.status(200).json({ muted });
  } catch (error) {
    console.error("Error updating task mute preference", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default withTaskWriteFlag(withTaskWriteFlag(handler, "GET", async () =>
  (await import("@/lib/api/notification-writes/mute")).GET,
), "POST", async () =>
  (await import("@/lib/api/notification-writes/mute")).POST,
);
