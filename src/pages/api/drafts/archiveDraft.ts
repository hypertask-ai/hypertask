import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const userId = session.userId;

  const draftId = Number(req.body?.draftId);
  if (!Number.isInteger(draftId) || draftId <= 0) {
    return res.status(400).json({ error: "Invalid draft id" });
  }

  try {
    const result = await prisma.drafts.updateMany({
      where: { id: draftId, userId, type: "Comment" },
      data: { saved: true },
    });

    if (result.count === 0) {
      return res.status(404).json({ error: "Draft not found" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Archive draft] Error:", error);
    return res.status(500).json({ error: "Could not archive draft" });
  }
}
