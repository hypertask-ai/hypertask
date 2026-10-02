import { tool } from "ai";
import { z } from "zod";
import { getReport, getReportUrl } from "@/utils/controllers/reports/reportService";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createGetReportTool(context: ToolContext) {
  const { sendStatus, user, actingAgentId } = context;
  return {
    hypertask_get_report: tool({
      description:
        "Get one saved HTML report, including its complete body, from an accessible Hypertask project/board.",
      inputSchema: z
        .object({
          project_id: z.coerce.number().int().positive(),
          slug: z.string().trim().min(1).max(64),
        })
        .strict(),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_get_report");
        const report = await getReport({
          userId: user.id,
          agentId: actingAgentId,
          projectId: input.project_id,
          slug: input.slug,
        });
        if (!report) {
          return { success: false, error: "Report not found or access denied" };
        }

        return sanitizeForJson({
          success: true,
          report: {
            id: report.id,
            project_id: report.projectId,
            slug: report.slug,
            title: report.title,
            description: report.description,
            body_html: report.bodyHtml,
            created_at: report.createdAt,
            updated_at: report.updatedAt,
            url: getReportUrl(report.projectId, report.slug),
          },
        });
      }),
    }),
  };
}
