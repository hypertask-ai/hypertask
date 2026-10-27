import { TOOL_METADATA } from "../config/tool-metadata";
import { createBoardAccessRequestSchema } from "@/lib/agents/boardAccessRequests/contracts";
import { BoardAccessRequestService } from "../lib/services/board-access-request.service";
import { executeWithService } from "../utils/executeWithService";

export const requestBoardAccessTool = {
  name: TOOL_METADATA.REQUEST_BOARD_ACCESS.name,
  description: TOOL_METADATA.REQUEST_BOARD_ACCESS.description,
  parameters: createBoardAccessRequestSchema,
  execute: (args: unknown, context: unknown) => executeWithService(context, BoardAccessRequestService, "create", createBoardAccessRequestSchema.parse(args)),
};
