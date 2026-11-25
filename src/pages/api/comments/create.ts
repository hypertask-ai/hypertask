import { parseCommentKind } from '@/lib/mcp/operations/comments/agentChatterRouting'
import { AGENT_LOG_NOTE, AGENT_LOG_UNAVAILABLE, agentLogText, writeAgentLogEntry } from '@/lib/mcp/operations/comments/agentLog'
import { AgentWritingError, agentWritingDetails } from '@/lib/agents/writing'
import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { withAgentScopeRequest, prepareAgentScope } from "@/lib/auth/agentScope";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { broadcastTaskComment } from "@/lib/realtime/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const currentUser = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, displayName: true, email: true, photoURL: true },
    });
    if (!currentUser) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { text, creatorId, taskId, ownerId, agentId } = req.body;
      await prepareAgentScope(session.userId, agentId);

      if (Number(creatorId) !== Number(currentUser.id)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!text || !creatorId || !taskId || !ownerId)
        return res.status(400).json({ message: "Bad request" });

      let kind: ReturnType<typeof parseCommentKind> | undefined = undefined;
      if (agentId) {
        try {
          kind = parseCommentKind(req.body.kind);
        } catch (error) {
          return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid comment kind", code: "invalid_field", field: "kind" });
        }
      }

      const storedText = agentId
        ? await inlineAgentImagesForUser(text, currentUser.id, { inlineImages: req.body.inline_images })
        : text;

      if (agentId && kind === undefined) {
        const note = await agentLogText(storedText);
        const activity = note
          ? await writeAgentLogEntry({
              principal: {
                userId: currentUser.id,
                agentId,
                teamScope: null,
                displayName: currentUser.displayName?.trim() || 'Hypertask agent',
                source: 'agent',
              },
              taskId,
              text: note,
              idempotencyKey: null,
            })
          : null;
        if (!activity) return res.status(503).json({ success: false, message: AGENT_LOG_UNAVAILABLE });
        return res.json({ success: true, routedTo: 'log', visibleToPeople: false, notice: AGENT_LOG_NOTE, activity });
      }

      const comment = await createCommentService({
        text: storedText,
        kind,
        creatorId,
        taskId,
        ownerId,
        currentUser,
        agentId,
      });

      void broadcastTaskComment(taskId, { originUserId: creatorId });

      return res.json(comment);
    } catch (error) {
      if (error instanceof AgentWritingError) return res.status(400).json({ message: error.message, code: error.code, field: error.field, details: agentWritingDetails(error) });
      console.log("🤔 ~ ERROR IN COMMENT CREATION:", error);
      if (error instanceof Error && error.message === "Task not found or access denied") {
        return res.status(404).json({ message: error.message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};

export default ((req, res) => withAgentScopeRequest(req, () => handler(req, res))) satisfies NextApiHandler;
