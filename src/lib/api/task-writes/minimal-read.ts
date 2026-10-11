import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "./route";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";

export const READ: TaskWriteRoute = async (request, authenticatedSession) => {
  try {
    const session = authenticatedSession ?? await getSessionUser(request.headers);
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ message: "Missing required field" }, { status: 400 });
    }
    const response = await prisma.task.findFirst({
      where: { id, project: projectContentAccessWhere(session.userId) },
    });
    if (!response) return NextResponse.json({ message: "Task not found" }, { status: 404 });
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.log({ error });
    return NextResponse.json({ message: "Internal server error" + JSON.stringify(error) }, { status: 500 });
  }
};
