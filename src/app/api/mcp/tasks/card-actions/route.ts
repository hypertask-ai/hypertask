import { withoutAuth } from "#with-auth";
import { POST as cardActionHandler } from "@/lib/mcp/tasks/cardActionHandler";

export const POST = withoutAuth(cardActionHandler);
