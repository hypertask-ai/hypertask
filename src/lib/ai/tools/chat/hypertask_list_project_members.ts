import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskListProjectMembersTool(context: ChatToolContext) {
  const { getProjectMembers, requestingUserId, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, z } = context;
  return tool({
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
    });
}
