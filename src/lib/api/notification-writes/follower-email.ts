import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "@/lib/api/task-writes/route";
import { sendMentionEmail } from "@/utils/controllers/notifications/sendMentionEmail";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    const { sender, receiver, taskTitle, taskLink, mentionType, taskId } =
      body as {
        sender: string;
        receiver: number;
        taskTitle: string;
        taskLink: string;
        // when present and equal to "mention", this is a direct @mention email
        mentionType?: "mention";
        taskId?: number;
      };
    if (Number(receiver) === session.userId) {
      return NextResponse.json({ message: "receiver is a sender" }, { status: 201 });
    } else {
      const parsedTaskId = Number(taskId);
      if (!Number.isInteger(parsedTaskId) || parsedTaskId <= 0) {
        return NextResponse.json({ message: "Missing required information" }, { status: 400 });
      }
      if (!(await userCanAccessTaskContent(session.userId, parsedTaskId))) {
        return NextResponse.json({ message: "Forbidden" }, { status: 403 });
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
        return NextResponse.json({ message: "success" }, { status: 200 });
      } else {
        return NextResponse.json({ message: "failed to send mention email" }, { status: 500 });
      }
    }
  },
});

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    return await route({ ...request, headers: request.headers, json: async () => body }, session);
  } catch (error) {
    console.log("🤔 ~ handler ~ error:", error);
    return NextResponse.json({ message: "an error occured" }, { status: 500 });
  }
};
