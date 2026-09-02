import type { NextApiHandler } from "next";
import {
  linkTaskPullRequest,
  PullRequestLinkError,
} from "@/lib/pullRequests/taskPullRequests";
import { AgentMutationLeaseConflictError } from "@/lib/mcp/tasks/agentMutationFence";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { broadcastTaskChange } from "@/lib/realtime/server";

interface LinkPullRequestHandlerDependencies {
  verifySession: typeof verifySession;
  linkTaskPullRequest: typeof linkTaskPullRequest;
  broadcastTaskChange: typeof broadcastTaskChange;
}

export function createLinkPullRequestHandler({
  verifySession: verifySignedSession,
  linkTaskPullRequest: linkPullRequest,
  broadcastTaskChange: broadcastChange,
}: LinkPullRequestHandlerDependencies): NextApiHandler {
  return async (request, response) => {
    if (request.method !== "POST") {
      return response.status(405).json({ message: "Method not allowed" });
    }

    const session = verifySignedSession(request.cookies[SESSION_COOKIE]);
    if (!session) {
      return response.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.id;
    const taskId = Number(request.body?.taskId);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) {
      return response.status(400).json({ message: "Bad request" });
    }
    if (typeof request.body?.url !== "string") {
      return response
        .status(400)
        .json({ message: "Pull request URL is required" });
    }

    try {
      const result = await linkPullRequest({
        taskId,
        userId,
        url: request.body.url,
      });
      try {
        await broadcastChange(taskId, { originUserId: userId });
      } catch (error) {
        console.warn("/api/tasks/linkPullRequest realtime delivery failed", error);
      }
      return response.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof PullRequestLinkError) {
        return response
          .status(error.status)
          .json({ message: error.message, code: error.code });
      }
      if (error instanceof AgentMutationLeaseConflictError) {
        return response.status(409).json({ message: error.message });
      }
      console.error("/api/tasks/linkPullRequest", error);
      return response.status(500).json({ message: "Internal server error" });
    }
  };
}

export default createLinkPullRequestHandler({
  verifySession,
  linkTaskPullRequest,
  broadcastTaskChange,
});
