import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "@/lib/api/task-writes/route";
import sectionGetAll from "@/utils/controllers/section/getAll";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const POST: TaskWriteRoute = async (request, authenticatedSession) => {
  const session = authenticatedSession ?? await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const userId = session.userId;
  if (!userId) {
    return NextResponse.json({ message: "Missing Required Credentials" }, { status: 400 });
  }
  try {
    const response = await sectionGetAll(userId);
    return NextResponse.json(response.json, { status: response.status });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error }, { status: 500 });
  }
};
