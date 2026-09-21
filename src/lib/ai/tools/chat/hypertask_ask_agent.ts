import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskAskAgentTool(context: ChatToolContext) {
  const { askFleetAgent, body, getAccessibleAgentBoard, getBoardAgentMembers, sendStatus, tool, user, z } = context;
  return tool({
      description:
        "Ask one of the board's AI agents, which are domain experts with knowledge beyond the board such as wiki or compliance knowledge, a question.",
      inputSchema: z.object({
        agent_id: z.string(),
        question: z.string(),
      }),
      execute: async (input) => {
        try {
          sendStatus("hypertask_ask_agent");
          const boardId = Number(body.default_context?.project_id);

          if (!Number.isInteger(boardId) || boardId <= 0) {
            return {
              success: false,
              error: "No board context is available for this agent request.",
            };
          }

          // default_context comes from the client, so the caller's own access
          // to that board has to be proven before its agents are reachable.
          // This is the agent-specific check on purpose: assertAccessibleProject
          // also demands a team, which would lock owners out of legacy boards.
          if (!(await getAccessibleAgentBoard(boardId, user.id))) {
            return {
              success: false,
              error: "Board not found or access denied.",
            };
          }

          const boardAgents = await getBoardAgentMembers(boardId, user.id);
          if (!boardAgents.some((row) => row.agent.id === input.agent_id)) {
            return {
              success: false,
              error: "That agent is not a member of this board.",
            };
          }

          return askFleetAgent({
            agentId: input.agent_id,
            question: input.question,
            context: {
              boardId,
              taskId: body.default_context?.task_id,
              requesterName: user.displayName || undefined,
            },
          });
        } catch (error) {
          console.error("[AI chat ask agent]", error);
          return { success: false, error: "The agent request failed." };
        }
      },
    });
}
