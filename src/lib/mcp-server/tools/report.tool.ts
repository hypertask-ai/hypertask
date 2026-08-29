import { TOOL_METADATA } from '../config/tool-metadata';
import { ReportService } from '../lib/services/report.service';
import { executeWithService } from '../utils/executeWithService';
import {
  getReportCrudBaseSchema,
  ReportCrudInputSchema,
} from '../validations/report.validation';

/**
 * Tool: report
 * Full CRUD for board reports.
 *
 * Actions: list | get | create | update | delete
 */
export const reportTool = {
  name: TOOL_METADATA.REPORT_CRUD.name,
  description: TOOL_METADATA.REPORT_CRUD.description,
  parameters: getReportCrudBaseSchema(),
  execute: async (args: unknown, context: unknown) => {
    const validatedInput = ReportCrudInputSchema.parse(args);
    return executeWithService(
      context,
      ReportService,
      'manageReport',
      validatedInput
    );
  },
};
