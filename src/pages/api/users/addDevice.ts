import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const MAX_DEVICES_PER_USER = 8;

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const session = await getSessionUser(
    new Headers(req.headers as Record<string, string>)
  );
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.method === "POST") {
    const { fcmToken } = req.body;
    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({ message: "Missing FCM Token" });
    }

    try {
      const device = await prisma.$transaction(async (tx) => {
        const existing = await tx.subscribedDevices.findUnique({
          where: { firebaseId: fcmToken },
        });
        if (existing?.userId === session.userId) return existing;

        const devices = await tx.subscribedDevices.findMany({
          where: { userId: session.userId },
          distinct: ["firebaseId"],
        });
        if (devices.length >= MAX_DEVICES_PER_USER) {
          await tx.subscribedDevices.delete({ where: { id: devices[0].id } });
        }

        return tx.subscribedDevices.upsert({
          where: { firebaseId: fcmToken },
          update: { userId: session.userId, sendNotifications: true },
          create: { userId: session.userId, firebaseId: fcmToken },
        });
      });

      return res.status(200).json({ data: device, message: "success" });
    } catch (error) {
      console.log("🤔 ~ addDevice ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  }

  if (req.method === "DELETE") {
    const { fcmToken } = req.query;
    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({ message: "Missing FCM Token" });
    }
    try {
      const deviceDeleted = await prisma.subscribedDevices.deleteMany({
        where: { firebaseId: fcmToken, userId: session.userId },
      });
      return res.status(200).json({ data: deviceDeleted, message: "success" });
    } catch (error) {
      console.log("🤔 ~ addDevice ~ error:", error);
      return res.status(400).json({ message: JSON.stringify(error) });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
};

export default handler;
