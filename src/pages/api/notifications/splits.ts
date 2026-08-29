import type { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  getSplitsNoImportant,
  isInboxSplitKey,
} from "@/lib/inboxSplitSettings";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) return res.status(401).json({ message: "Unauthorized" });

    if (req.method === "GET") {
      const userSetting = await prisma.userSetting.findUnique({
        where: { userId: session.userId },
        select: { notificationMatrix: true },
      });
      if (!userSetting) {
        return res.status(404).json({ message: "User settings not found" });
      }
      return res.status(200).json({
        splitsNoImportant: getSplitsNoImportant(
          userSetting.notificationMatrix
        ),
      });
    }

    const splitsNoImportant = req.body?.splitsNoImportant;
    if (
      !Array.isArray(splitsNoImportant) ||
      splitsNoImportant.length > 200 ||
      !splitsNoImportant.every(isInboxSplitKey)
    ) {
      return res.status(400).json({ message: "Invalid inbox split settings" });
    }

    const uniqueSplits = Array.from(new Set(splitsNoImportant));
    const updatedRows = await prisma.$executeRaw`
      UPDATE "UserSetting"
      SET "notificationMatrix" = jsonb_set(
        COALESCE("notificationMatrix", '{}'::jsonb),
        '{splitsNoImportant}',
        ${JSON.stringify(uniqueSplits)}::jsonb
      )
      WHERE "userId" = ${session.userId}
    `;
    if (updatedRows === 0) {
      return res.status(404).json({ message: "User settings not found" });
    }

    return res.status(200).json({
      splitsNoImportant: uniqueSplits,
    });
  } catch (error) {
    console.error("Error updating inbox split settings", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
