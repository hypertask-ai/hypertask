import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "./route";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8917_AGENT_WAITING_PERSON_FLAG } from "@/lib/flags/definitions/htpr-8917-agent-waiting-person";
import { setTaskWaitingOn } from "@/lib/tasks/setWaitingOn";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  prepare: (session) => loadSessionUserRecord(session.userId),
  operation: async (body, currentUser) => {
    const req = { body };
    try {
      const taskId = Number(req.body.taskId);
      const userId = req.body.userId == null ? req.body.userId : Number(req.body.userId);
      const waitingAgentId = req.body.agentId === undefined ? undefined : req.body.agentId;
      const blockerCommentId = req.body.blockerCommentId;
      const reason = typeof req.body.reason === "string" ? req.body.reason.slice(0, 500) : undefined;
      if (!Number.isInteger(taskId) || (userId !== undefined && userId !== null && !Number.isInteger(userId))
        || (waitingAgentId !== undefined && waitingAgentId !== null && typeof waitingAgentId !== "string")
        || (blockerCommentId !== undefined && blockerCommentId !== null && (!Number.isInteger(blockerCommentId) || blockerCommentId <= 0 || blockerCommentId > 2_147_483_647))
        || (userId === undefined && blockerCommentId === undefined && waitingAgentId === undefined)) {
        return NextResponse.json({ message: "Bad request" }, { status: 400 });
      }

      if (waitingAgentId !== undefined && !(await isFeatureEnabled(HTPR_8917_AGENT_WAITING_PERSON_FLAG, currentUser.id))) {
        return NextResponse.json({ message: "Agent waiting person is not enabled" }, { status: 404 });
      }
      const result = await setTaskWaitingOn({ taskId, userId, waitingAgentId, blockerCommentId, reason, currentUser });
      return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
      console.error("/api/tasks/waiting-on", error);
      return NextResponse.json({ message: "Internal server error" }, { status: 500 });
    }
  },
});
