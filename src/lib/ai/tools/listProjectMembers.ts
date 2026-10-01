import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListProjectMembersTool(context: ToolContext) {
  const { sendStatus, user, requestingUserId } = context;
  return {
    hypertask_list_project_members: tool({
      description:
        "List members and board agents for one project. Returns only members scoped to that project.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_project_members");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return {
            success: false,
            error:
              access.error.status === 403
                ? "User does not have permission to view members of this project"
                : access.error.message,
          };
        }
        // HTPR-3805: "list members" must include the caller — excluding them
        // dropped the owner entirely on boards with zero Member rows.
        const result = await getProjectMembers(
          input.project_id,
          undefined,
          requestingUserId,
        );
        if (result.error) {
          return { success: false, error: result.error.message };
        }
        return sanitizeForJson({
          success: true,
          members: result.members,
          projectId: input.project_id,
        });
      },
    }),
  };
}
