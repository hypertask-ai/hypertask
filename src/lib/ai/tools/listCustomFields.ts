import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getCustomFieldsForProject } from "@/utils/controllers/customFields";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListCustomFieldsTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_list_custom_fields: tool({
      description:
        "List the custom fields defined on a board (e.g. ICE, Story Points). Use this to see valid field names, types, and Select options before setting a value.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_custom_fields");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }
        const customFields = await getCustomFieldsForProject(input.project_id);
        return sanitizeForJson({
          success: true,
          projectId: input.project_id,
          customFields,
        });
      }),
    }),
  };
}
