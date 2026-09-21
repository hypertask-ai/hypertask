import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  parseViewOrder,
  saveDefaultViewOrder,
  ViewOrderError,
} from "@/utils/controllers/projects/views/viewOrder";
import type { NextApiHandler } from "next";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const projectId = Number(req.body.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ message: "Invalid projectId" });
    }
    const defaultViewOrder = await saveDefaultViewOrder(
      projectId,
      session.id,
      parseViewOrder(req.body.viewOrder)
    );
    return res.status(200).json({ defaultViewOrder });
  } catch (error) {
    if (error instanceof ViewOrderError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("set default view order failed", error);
    return res.status(500).json({ message: "Unable to set default view order" });
  }
};

export default handler;
