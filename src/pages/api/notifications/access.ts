import type { NextApiHandler } from "next";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getInboxAccessibleProjectIds } from "@/utils/controllers/notifications/getAccessibleProjectIds";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>),
    );
    if (!session) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const projectIds = await getInboxAccessibleProjectIds(session.userId);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.status(200).json({ accountId: session.userId, projectIds });
  } catch (error) {
    console.error("Failed to validate Inbox project access", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
