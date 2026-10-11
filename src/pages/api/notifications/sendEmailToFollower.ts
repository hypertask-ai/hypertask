import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import { NextApiRequest, NextApiResponse } from "next";
import { sendMentionEmail } from "@/utils/controllers/notifications/sendMentionEmail";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) return res.status(401).json({ message: "Unauthorized" });
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
      if (Number(receiver) === session.userId) {
        return res.status(201).json({ message: "receiver is a sender" });
      } else {
        const parsedTaskId = Number(taskId);
        if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
          return res.status(400).json({ message: "Missing required information" });
        }
        if (!(await userCanAccessTaskContent(session.userId, parsedTaskId))) {
          return res.status(403).json({ message: "Forbidden" });
        }
        const result = await sendMentionEmail(
          receiver,
          sender,
          taskTitle,
          taskLink,
          mentionType,
          undefined,
          parsedTaskId
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

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/notification-writes/follower-email")).POST,
);
