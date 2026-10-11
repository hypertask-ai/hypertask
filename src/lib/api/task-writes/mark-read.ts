import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { markTaskRead } from "@/utils/controllers/tasks/markRead";

const parseBody = (body: unknown) => {
  if (typeof body !== "string") return body as { taskId?: unknown };

  try {
    return JSON.parse(body) as { taskId?: unknown };
  } catch {
    return {};
  }
};

export const POST = taskWriteRoute({
  schema: z.custom<unknown>(() => true),
  validationMessage: "Task id is required",
  allowNullBody: true,
  operation: async (body, session) => {
    try {
      const { taskId } = parseBody(body);
      const parsedTaskId = parseInt(String(taskId), 10);

      if (!Number.isFinite(parsedTaskId)) {
        return NextResponse.json({ message: "Task id is required" }, { status: 400 });
      }

      const response = await markTaskRead(parsedTaskId, session.userId);
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
