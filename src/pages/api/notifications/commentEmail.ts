import { NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";
import { sendEmailNotification } from "@/utils/controllers/notifications/sendNotification";
import { shouldNotify } from "@/utils/controllers/notifications/shouldNotify";

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === "POST") {
    try {
      const {
        comment,
        commentText,
        taskTitle,
        taskLink,
        creatorName,
        emailArray: toSendToEmail,
        isMention, // Flag to indicate if this is a mention notification
      } = req.body;
      console.log("🚀 ~ toSendToEmail:", toSendToEmail);
      console.log("🚀 ~ file: commentEmail.js:41 ~ comment:", comment);

      const checkstatus = await prisma.user.findFirst({
        where: {
          email: toSendToEmail,
        },
        select: { id: true },
      });

      if (checkstatus) {
        const notificationType = isMention ? "Mentioned" : "Comment";
        const shouldSend = await shouldNotify(
          checkstatus.id,
          notificationType,
          "email"
        );

        if (shouldSend) {
          sendEmailNotification("Comment", {
            sender: creatorName,
            recipient: toSendToEmail,
            title: taskTitle,
            link: taskLink,
            commentText: commentText,
            userId: checkstatus.id,
            replyTaskId:
              typeof comment?.taskId === "number" ? comment.taskId : undefined,
          });
        }
      }
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
