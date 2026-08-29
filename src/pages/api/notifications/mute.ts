import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";

const parseTaskId = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const taskId = Number(value);
  return Number.isInteger(taskId) && taskId > 0 ? taskId : null;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const userCookie = req.cookies.nookies_user;
    if (!userCookie) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = JSON.parse(userCookie);

    if (req.method === "GET") {
      const taskId = parseTaskId(req.query.taskId);
      if (!taskId) {
        return res.status(400).json({ message: "Invalid task ID" });
      }

      const taskMute = await prisma.taskMute.findUnique({
        where: { taskId_userId: { taskId, userId: user.id } },
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
        where: { taskId_userId: { taskId, userId: user.id } },
        update: {},
        create: { taskId, userId: user.id },
      });
    } else {
      await prisma.taskMute.deleteMany({
        where: { taskId, userId: user.id },
      });
    }

    return res.status(200).json({ muted });
  } catch (error) {
    console.error("Error updating task mute preference", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
