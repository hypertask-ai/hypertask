import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { listReports, getReportUrl } from "@/utils/controllers/reports/reportService";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createListReportsTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_list_reports: tool({
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
    }),
  };
}
