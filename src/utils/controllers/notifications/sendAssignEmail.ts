import prisma from "@/lib/prisma";
import { sendEmailNotification } from "./sendNotification";
import { shouldNotify } from "./shouldNotify";

export async function sendAssignEmail(
  assignerName: string,
  taskTitle: string,
  taskLink: string,
  status: string,
  emailTo: string,
  taskId?: number
) {
  const checkstatus = await prisma.user.findFirst({
    where: {
      email: emailTo,
    },
    select: { id: true },
  });

  if (checkstatus && (await shouldNotify(checkstatus.id, "Assigned", "email"))) {
    sendEmailNotification(status === "unassign" ? "Unassigned" : "Assigned", {
      sender: assignerName,
      recipient: emailTo,
      title: taskTitle,
      link: taskLink,
      userId: checkstatus.id,
      // Unassignment creates no notification row, so a digest would find nothing
      // to report and silently swallow the email. It stays immediate.
      taskId: status === "unassign" ? undefined : taskId,
      replyTaskId: taskId,
    });
  }
}
