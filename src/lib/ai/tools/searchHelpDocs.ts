import { tool } from "ai";
import { z } from "zod";
import { searchHelpDocs } from "@/lib/help-docs/searchHelpDocs";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createSearchHelpDocsTool(context: ToolContext) {
  const { sendStatus } = context;
  return {
    search_help_docs: tool({
      description:
        "Search the Hypertask help center (help.hypertask.ai) for how-to and product-feature articles. Use for questions about how Hypertask itself works — boards, columns/sections, the Command Center (Ctrl+K), keyboard shortcuts, AI features and models, notifications, sharing, pricing, MCP/CLI setup. Do NOT use for questions about the user's own tasks or comments (use rag_retrieval/list_tasks/search_tasks for those).",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        limit: z.coerce.number().int().min(1).max(6).default(4),
      }),
      execute: async (input) => {
        sendStatus("search_help_docs");
        return sanitizeForJson(await searchHelpDocs(input));
      },
    }),
  };
}
