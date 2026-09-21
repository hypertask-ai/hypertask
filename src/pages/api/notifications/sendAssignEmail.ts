import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
import { NextApiRequest, NextApiResponse } from "next";
import { sendAssignEmail } from "@/utils/controllers/notifications/sendAssignEmail";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const { assignerName, taskTitle, taskLink, status, emailTo } = req.body;

      sendAssignEmail(assignerName, taskTitle, taskLink, status, emailTo);

      return res.status(200).json({ message: "success" });
    } catch (error) {
      htLogger.info("🤔 ~ handler ~ error:", error);
      res.status(500).json({ message: "an error occured" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default withAuth(handler, { authenticateInHandler: true });
