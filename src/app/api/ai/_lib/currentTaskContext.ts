import type { AgentTokenTeamScope } from '@/lib/mcp/auth/types';
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { assertSafeWebhookTarget } from "@/lib/mcp/webhooks/ssrfGuard";

export async function loadCurrentTaskContext(
  taskIds: Array<number | null | undefined>,
  userId: number | null | undefined,
  agentId?: string | null,
  options?: { role?: "primary" | "related"; projectId?: number | null; teamScope?: AgentTokenTeamScope | null }
): Promise<string> {
  const ids = Array.from(
    new Set(
      (taskIds ?? []).filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0
      )
    )
  );
  if (ids.length === 0 || !userId) return "";

  const tasks = await prisma.task.findMany({
    where: {
      id: { in: ids },
      project: {
        ...projectContentAccessWhere(userId, agentId, options?.teamScope),
        ...(options?.projectId ? { id: options.projectId } : {}),
      },
    },
    select: {
      id: true,
      title: true,
      ticketNumber: true,
      description_: { select: { content: true } },
      comments: {
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          text: true,
          activity: true,
          createdAt: true,
          agentDisplayName: true,
          agent: { select: { displayName: true } },
          creator: { select: { displayName: true, email: true } },
        },
      },
    },
  });
  if (tasks.length === 0) return "";

  return tasks
    .map((task) => formatTaskContext(task, options?.role ?? "primary"))
    .join("\n\n");
}

export async function resolveAiUsageTaskId(args: {
  taskId?: number | null;
  projectId?: number | null;
  userId: number;
  agentId?: string | null; teamScope?: AgentTokenTeamScope | null;
}): Promise<number | null> {
  if (
    !Number.isInteger(args.taskId) ||
    Number(args.taskId) <= 0 ||
    !Number.isInteger(args.projectId) ||
    Number(args.projectId) <= 0
  ) {
    return null;
  }

  const task = await prisma.task.findFirst({
    where: {
      id: Number(args.taskId),
      projectId: Number(args.projectId),
      project: projectContentAccessWhere(args.userId, args.agentId, args.teamScope),
    },
    select: { id: true },
  });
  return task?.id ?? null;
}

export async function loadCurrentTaskImages(
  taskIds: Array<number | null | undefined>,
  userId: number | null | undefined
): Promise<Array<{ url: string; mimeType: string; type: string }>> {
  const ids = Array.from(
    new Set(
      (taskIds ?? []).filter(
        (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0
      )
    )
  );
  if (ids.length === 0 || !userId) return [];

  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, project: projectContentAccessWhere(userId) },
    select: {
      description_: { select: { content: true } },
      comments: {
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { text: true },
      },
    },
  });

  const urls = new Set<string>();
  for (const task of tasks) {
    for (const url of extractImageUrls(task.description_?.content)) urls.add(url);
    for (const comment of task.comments) {
      for (const url of extractImageUrls(comment.text)) urls.add(url);
    }
  }

  const candidates = Array.from(urls).slice(0, 12);
  const verdicts = await Promise.all(
    candidates.map((url) => assertSafeWebhookTarget(url))
  );

  return candidates
    .filter((_, i) => verdicts[i].ok)
    .map((url) => ({ url, mimeType: mimeTypeForUrl(url), type: "image" }));
}

const IMG_SRC_RE = /<img\b[^>]*?\bsrc=["']([^"']+)["']/gi;

function extractImageUrls(html: string | null | undefined): string[] {
  if (!html) return [];
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMG_SRC_RE.exec(html)) !== null) {
    const url = match[1];
    if (url && /^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}

function mimeTypeForUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

export function formatTaskContext(
  task: {
    id: number;
    title: string;
    ticketNumber: string | null;
    description_: { content: string | null } | null;
    comments: Array<{
      text: string | null;
      activity: unknown;
      createdAt: Date;
      agentDisplayName: string | null;
      agent: { displayName: string } | null;
      creator: { displayName: string | null; email: string | null } | null;
    }>;
  },
  role: "primary" | "related" = "primary"
): string {
  const description = task.description_?.content?.trim() ?? "";
  const comments = task.comments
    .map((c) => {
      const text = htmlToText(
        c.text || (c.activity ? JSON.stringify(c.activity) : "")
      );
      if (!text) return null;
      const who =
        c.agent?.displayName ||
        c.agentDisplayName ||
        c.creator?.displayName ||
        c.creator?.email ||
        "Unknown";
      return `- ${who}: ${text}`;
    })
    .filter((line): line is string => line !== null)
    .reverse();

  const label = task.ticketNumber
    ? `${task.ticketNumber}: ${task.title}`
    : task.title;
  const heading =
    role === "primary"
      ? `=== THIS TICKET (${label}) — a ticket the user is asking about; use it as primary context ===`
      : `=== RELATED TICKET (${label}) — supporting context ===`;
  return [
    heading,
    `Title: ${task.title}`,
    `Description HTML (preserve this block structure when editing): ${description || "(empty)"}`,
    "",
    "Comments (oldest first):",
    comments.length ? comments.join("\n") : "(no comments)",
  ].join("\n");
}

export function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
