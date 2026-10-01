import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

type NotificationLevel = "all" | "direct" | "nothing";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") {
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
    const { notificationLevel } = req.body as { notificationLevel?: NotificationLevel };

    if (!notificationLevel || !["all", "direct", "nothing"].includes(notificationLevel)) {
      return res.status(400).json({ message: "Invalid notification level" });
    }

    const updated = await prisma.userSetting.update({
      where: { userId },
      data: {
        notificationPreference: notificationLevel,
      },
      select: {
        notificationPreference: true,
      },
    });

    return res.status(200).json({ notificationPreference: updated.notificationPreference });
  } catch (error) {
    console.error("Error updating notification preference", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;





