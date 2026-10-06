import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
import SearchForOrphanTasks from "@/utils/controllers/tasks/getOrphanTasks";

// Keep this reader's legacy unauthenticated contract.
export const GET: TaskWriteRoute = async (request) => {
  try {
    const query = taskReadQuery(request);
    const { projectId, searchQuery, currentTaskId } = query;

    if (!projectId || !currentTaskId) {
      return NextResponse.json("Missing Required Data", { status: 200 });
    }

    const response = await SearchForOrphanTasks(
      parseInt(projectId as string),
      parseInt(currentTaskId as string),
      searchQuery as string
    );

    return NextResponse.json(response, { status: response.status });
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return NextResponse.json([], { status: 200 });
  }
};
