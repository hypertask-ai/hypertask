import { tool } from "ai";
import { RenameBoardInputSchema } from "@/lib/mcp-server/validations/project.validation";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import updateProject from "@/utils/controllers/projects/update";
import { broadcastBoardChange } from "@/lib/realtime/server";
import { withToolErrors } from "./execution";
import type { ToolContext } from "./context";

export function createRenameBoardTool(context: ToolContext) {
  const { user, actingAgentId, sendStatus } = context;
  return {
    hypertask_rename_board: tool({
      description:
        "Rename a board/project to the user's requested title. Use the current board's project_id from context for 'this board', or an ID returned by list_projects. Never infer an ID from a board name.",
      inputSchema: RenameBoardInputSchema,
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_rename_board");
        const actor = await loadSessionUserRecord(user.id);
        const result = await updateProject(input.project_id, input.title, undefined, undefined, actor, actingAgentId);
        if (result.status !== 200 || !("id" in result.json)) {
          const error = "message" in result.json ? result.json.message : "Unable to rename board";
          return { success: false, error };
        }
        void broadcastBoardChange(input.project_id, { originUserId: user.id });
        const { id, title, name } = result.json;
        return { success: true, project: { id, title, name } };
      }),
    }),
  };
}
