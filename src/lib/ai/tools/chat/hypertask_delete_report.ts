import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskDeleteReportTool(context: ChatToolContext) {
  const { actingAgentId, buildBulkOperationKey, bulkPreviewsIssued, confirmationSessionId, deleteReport, getReport, getReportUrl, requireCrossMessageConfirmation, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Delete one saved HTML report. This is destructive: first preview the exact report, then ask for confirmation and end the turn. Set confirmed=true only after the user approves in a later message.",
      inputSchema: z
        .object({
          project_id: z.coerce.number().int().positive(),
          slug: z.string().trim().min(1).max(64),
          confirmed: z.boolean().optional(),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_report");
        const existing = await getReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!existing) {
          return { success: false, error: "Report not found or access denied" };
        }

        const operationKey = buildBulkOperationKey("delete-report", [
          { key: `report:${existing.id}` },
        ]);
        if (
          (await requireCrossMessageConfirmation({
            userId: user.id,
            sessionId: confirmationSessionId,
            operationKey,
            confirmed: input.confirmed,
            previewsIssuedThisRequest: bulkPreviewsIssued,
          })) === "preview"
        ) {
          return sanitizeForJson({
            success: false,
            confirmation_required: true,
            report: {
              id: existing.id,
              title: existing.title,
              slug: existing.slug,
              url: getReportUrl(existing.projectId, existing.slug),
            },
            message:
              "Nothing changed. End your turn, show this exact report to the user, and ask them to confirm deletion. Only after they approve in a new message, call this tool again with confirmed=true.",
          });
        }

        const deleted = await deleteReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!deleted) {
          return { success: false, error: "Report not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          report: {
            id: deleted.id,
            project_id: deleted.projectId,
            slug: deleted.slug,
            title: deleted.title,
            url: getReportUrl(deleted.projectId, deleted.slug),
          },
        });
      }),
    });
}
