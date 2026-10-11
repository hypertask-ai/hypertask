import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "@/lib/api/task-writes/route";
import sectionGetByTask from "@/utils/controllers/section/getByTask";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const req = { body: await request.json() };
  const { taskId } = req.body;
  if (!taskId) {
    return NextResponse.json({ message: "Missing TaskId" }, { status: 400 });
  }
  try {
    const response = await sectionGetByTask(taskId, session.userId);
    return NextResponse.json(response.json, { status: response.status });
  } catch (error) {
    console.error("Error:", error);
  }
};
