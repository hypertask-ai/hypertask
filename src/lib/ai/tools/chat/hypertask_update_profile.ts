import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskUpdateProfileTool(context: ChatToolContext) {
  const { actingAgentId, getUpdateProfileInputSchema, sanitizeForJson, sendStatus, tool, updateOwnProfile, user, withToolErrors } = context;
  return tool({
      description:
        "Update the signed-in human user's display name, profile photo URL, or both. This updates the same explicit profile-set flags as the settings and MCP surfaces. Agent-targeted chats cannot modify the human profile.",
      inputSchema: getUpdateProfileInputSchema(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_profile");
        if (actingAgentId) {
          return {
            success: false,
            error: "Agent chats cannot modify the human account profile",
          };
        }

        const updated = await updateOwnProfile(user.id, input);
        if (!updated) {
          return { success: false, error: "User not found" };
        }
        return sanitizeForJson({
          success: true,
          user: {
            id: updated.id,
            email: user.email,
            displayName: updated.displayName,
            photoURL: updated.photoURL,
          },
        });
      }),
    });
}
