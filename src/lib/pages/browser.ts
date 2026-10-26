import { z } from "zod";

const linkedTicketSchema = z.object({
  id: z.number(),
  title: z.string(),
  ticketNumber: z.string().nullable(),
  projectId: z.number(),
  uniqueIndex: z.number(),
});

const pageListSchema = z.object({
  pages: z.array(z.object({
    id: z.number(),
    publicId: z.string(),
    title: z.string(),
    projectId: z.number(),
    project: z.object({ id: z.number(), title: z.string() }),
    updatedAt: z.string().nullable(),
    linkedTasks: z.array(linkedTicketSchema),
  })),
});

export type LinkedPageTicket = z.infer<typeof linkedTicketSchema>;
export type BrowserPage = z.infer<typeof pageListSchema>["pages"][number];

export async function listBrowserPages({
  projectId,
  archived = false,
  query = "",
  signal,
}: {
  projectId?: number;
  archived?: boolean;
  query?: string;
  signal?: AbortSignal;
} = {}): Promise<BrowserPage[]> {
  const params = new URLSearchParams({
    scope: projectId === undefined ? "all" : "board",
    archived: archived ? "1" : "0",
    q: query,
  });
  if (projectId !== undefined) params.set("project_id", String(projectId));
  const response = await fetch(`/api/pages/list?${params}`, { signal });
  if (!response.ok) throw new Error("Could not load pages");
  return pageListSchema.parse(await response.json()).pages;
}

export async function changePageLink({
  publicId,
  taskId,
  remove = false,
}: {
  publicId: string;
  taskId: number;
  remove?: boolean;
}): Promise<void> {
  const response = await fetch(`/api/pages/${publicId}/links`, {
    method: remove ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
  });
  if (!response.ok) throw new Error("Could not change the page link");
}
