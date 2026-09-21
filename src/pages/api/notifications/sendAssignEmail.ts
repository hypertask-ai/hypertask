import { NextApiRequest, NextApiResponse } from "next";
import { sendAssignEmail } from "@/utils/controllers/notifications/sendAssignEmail";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const { assignerName, taskTitle, taskLink, status, emailTo } = req.body;

      sendAssignEmail(assignerName, taskTitle, taskLink, status, emailTo);

      return res.status(200).json({ message: "success" });
    } catch (error) {
      console.log("🤔 ~ handler ~ error:", error);
      res.status(500).json({ message: "an error occured" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
