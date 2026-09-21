import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskListReportsTool(context: ChatToolContext) {
  const { getReportUrl, listReports, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "List the reports on one Hypertask project/board. Returns each report's id, slug, title, and url.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_list_reports");
        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const reports = await listReports({
          userId: user.id,
          projectId: input.project_id,
        });
        if (!reports) {
          return { success: false, error: "Project not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          reports: reports.map((report) => ({
            id: report.id,
            slug: report.slug,
            title: report.title,
            url: getReportUrl(report.projectId, report.slug),
          })),
        });
      }),
    });
}
