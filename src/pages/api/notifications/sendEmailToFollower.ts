import { NextApiRequest, NextApiResponse } from "next";
import { sendMentionEmail } from "@/utils/controllers/notifications/sendMentionEmail";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const user = JSON.parse(req.cookies.nookies_user!);
      const { sender, receiver, taskTitle, taskLink, mentionType, taskId } =
        req.body as {
          sender: string;
          receiver: number;
          taskTitle: string;
          taskLink: string;
          // when present and equal to "mention", this is a direct @mention email
          mentionType?: "mention";
          taskId?: number;
        };
      if (receiver === user?.id) {
        return res.status(201).json({ message: "receiver is a sender" });
      } else {
        const result = await sendMentionEmail(
          receiver,
          sender,
          taskTitle,
          taskLink,
          mentionType,
          undefined,
          taskId
        );
        if (result) {
          return res.status(200).json({ message: "success" });
        } else {
          return res.status(500).json({ message: "failed to send mention email" });
        }
      }
    } catch (error) {
      console.log("🤔 ~ handler ~ error:", error);
      res.status(500).json({ message: "an error occured" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default handler;
