import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskUpdateReportTool(context: ChatToolContext) {
  const { REPORT_BODY_MAX, REPORT_CAPABILITIES, REPORT_SLUG_RE, ReportValidationError, getReportUrl, sanitizeForJson, sendStatus, tool, updateReport, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description: `Update a standalone HTML report on one Hypertask project/board. Pick a short kebab-case slug, put all data in the HTML because it cannot be fetched later, and give the user the returned url. ${REPORT_CAPABILITIES}`,
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        slug: z.string().max(64).regex(REPORT_SLUG_RE),
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().optional(),
        body_html: z.string().max(REPORT_BODY_MAX).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_report");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        try {
          const report = await updateReport({
            userId: user.id,
            projectId: input.project_id,
            slug: input.slug,
            title: input.title,
            description: input.description,
            bodyHtml: input.body_html,
          });
          if (!report) {
            return { success: false, error: "Report not found or access denied" };
          }

          return sanitizeForJson({
            success: true,
            report: {
              id: report.id,
              slug: report.slug,
              title: report.title,
              url: getReportUrl(report.projectId, report.slug),
            },
          });
        } catch (error) {
          if (error instanceof ReportValidationError) {
            return { success: false, error: error.message };
          }
          throw error;
        }
      }),
    });
}
