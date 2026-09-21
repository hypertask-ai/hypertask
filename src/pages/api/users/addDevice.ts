import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const MAX_DEVICES_PER_USER = 8;

/**
 * Registers (POST) and releases (DELETE) this browser's push token.
 *
 * A push token identifies a browser, so it belongs to exactly one account at a
 * time. Registration used to look for a row matching this token AND the current
 * user, and on not finding one simply create another, leaving the token
 * registered to whoever signed in before. A browser signed in as one account
 * then received the other account's notifications, ticket titles included, for
 * boards it could not open (HTPR-4865). Signing out cleared it; signing in as
 * someone else did not.
 */
const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  // Identity comes from the signed session. It used to come from nookies_user,
  // which is unsigned and client-writable, so a caller could register their own
  // browser against any user id and start receiving that person's push.
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

        // The unique firebaseId constraint makes ownership transfer atomic.
        // Concurrent registrations can no longer both create a row.
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
      // Scoped to the caller: this ran on the token alone, so anyone holding a
      // token could silence that browser's notifications.
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
