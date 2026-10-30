import { TOOL_METADATA } from "../config/tool-metadata";
import { getBoardAccessRequestSchema } from "@/lib/agents/boardAccessRequests/contracts";
import { BoardAccessRequestService } from "../lib/services/board-access-request.service";
import { executeWithService } from "../utils/executeWithService";

export const getBoardAccessRequestTool = {
  name: TOOL_METADATA.GET_BOARD_ACCESS_REQUEST.name,
  description: TOOL_METADATA.GET_BOARD_ACCESS_REQUEST.description,
  parameters: getBoardAccessRequestSchema,
  execute: (args: unknown, context: unknown) => executeWithService(context, BoardAccessRequestService, "get", getBoardAccessRequestSchema.parse(args)),
};
