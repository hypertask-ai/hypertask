import { NextResponse } from "next/server";
import { z } from "zod";
import { legacyTaskWriteSession, taskWriteRoute, type TaskWriteRoute } from "./route";
import {
  linkTaskPullRequest,
  PullRequestLinkError,
} from "@/lib/pullRequests/taskPullRequests";
import { AgentMutationLeaseConflictError } from "@/lib/mcp/tasks/agentMutationFence";
import { broadcastTaskChange } from "@/lib/realtime/server";

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Bad request",
  allowNullBody: true,
  operation: async (body, session) => {
    const request = { body };
    const userId = session.userId;
    const taskId = Number(request.body?.taskId);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      return NextResponse.json({ message: "Bad request" }, { status: 400 });
    }
    if (typeof request.body?.url !== "string") {
      return NextResponse.json({ message: "Pull request URL is required" }, { status: 400 });
    }

    try {
      const result = await linkTaskPullRequest({
        taskId,
        userId,
        url: request.body.url,
      });
      try {
        await broadcastTaskChange(taskId, { originUserId: userId });
      } catch (error) {
        console.warn("/api/tasks/linkPullRequest realtime delivery failed", error);
      }
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      if (error instanceof PullRequestLinkError) {
        return NextResponse.json({ message: error.message, code: error.code }, { status: error.status });
      }
      if (error instanceof AgentMutationLeaseConflictError) {
        return NextResponse.json({ message: error.message }, { status: 409 });
      }
      console.error("/api/tasks/linkPullRequest", error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});

export const POST: TaskWriteRoute = async (request) => {
  const session = await legacyTaskWriteSession(request);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  return route(request, session);
};
