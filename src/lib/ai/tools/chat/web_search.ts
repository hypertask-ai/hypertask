import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createWebSearchTool(context: ChatToolContext) {
  const { sanitizeForJson, sendStatus, tool, z } = context;
  return tool({
      description:
        process.env.TAVILY_API_KEY
          ? "Search the web for current information using Tavily."
          : "Unavailable: TAVILY_API_KEY is not configured on the server.",
      inputSchema: z.object({
        query: z.string().min(1).max(400),
        max_results: z.coerce.number().int().min(1).max(10).default(5),
        search_depth: z.enum(["basic", "advanced"]).default("basic"),
      }),
      execute: async (input) => {
        sendStatus("web_search");
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
          return {
            success: false,
            unavailable: true,
            error: "web_search is unavailable because TAVILY_API_KEY is not configured.",
          };
        }
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: input.query,
            max_results: input.max_results,
            search_depth: input.search_depth,
            include_answer: true,
            include_raw_content: false,
          }),
        });
        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          return {
            success: false,
            error: `Tavily search failed (${response.status}): ${text}`,
          };
        }
        const json = (await response.json()) as {
          answer?: string;
          results?: Array<{
            title?: string;
            url?: string;
            content?: string;
            score?: number;
          }>;
        };
        return sanitizeForJson({
          success: true,
          answer: json.answer,
          results: (json.results ?? []).map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content,
            score: result.score,
          })),
        });
      },
    });
}
