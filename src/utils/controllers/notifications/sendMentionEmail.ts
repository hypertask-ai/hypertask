import prisma from "@/lib/prisma";
import { sendEmailNotification } from "./sendNotification";
import { shouldNotify } from "./shouldNotify";

export async function sendMentionEmail(
  receiver: number,
  sender: string,
  taskTitle: string,
  taskLink: string,
  mentionType: "mention" | undefined,
  commentText?: string,
  taskId?: number
) {
  try {
    const useremail = await prisma.user.findUnique({
      where: {
        id: receiver,
      },
      select: {
        email: true,
        displayName: true,
      },
    });
    const type =
      mentionType === "mention" ? "Mentioned" : "AddedToFollowerInTask";
    if (useremail && (await shouldNotify(receiver, type, "email"))) {
      return await sendEmailNotification(
        mentionType === "mention" ? "Mention" : "Follower",
        {
          sender,
          recipient: useremail.email,
          recipientName: useremail.displayName ?? undefined,
          title: taskTitle,
          link: taskLink,
          commentText,
          userId: receiver,
          taskId,
        },
      );
    }
    return true;
  } catch (error) {
    console.log("🚀 ~ sendMentionEmail ~ error:", error);
    return false;
  }
}
