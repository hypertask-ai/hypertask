import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { assertSafeWebhookTarget } from "@/lib/mcp/webhooks/ssrfGuard";

// Load the full content (title, description, all comments) of specific tickets so
// AI surfaces always have the ticket the user is looking at — instead of relying on
// a semantic search that can miss it. Used by the @mention bot, the sidebar chat and
// the task writer.
//
// SECURITY: task ids come from the client, so the fetch is scoped to projects the
// user actually belongs to. A crafted request cannot read a ticket from another
// team this way. Pass agentId for agent-bound MCP tokens: an agent is only on some
// of its owner's boards, so scoping by the human alone would let it read tickets
// from boards it was never added to. The access helper deliberately supports
// owned legacy teamless boards.
export async function loadCurrentTaskContext(
  taskIds: Array<number | null | undefined>,
  userId: number | null | undefined,
  agentId?: string | null,
  options?: { role?: "primary" | "related"; projectId?: number | null }
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
        ...projectContentAccessWhere(userId, agentId),
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

/**
 * Resolve an untrusted task id only when it belongs to the attributed project
 * and the human/agent actor can access that project.
 */
export async function resolveAiUsageTaskId(args: {
  taskId?: number | null;
  projectId?: number | null;
  userId: number;
  agentId?: string | null;
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
      project: projectContentAccessWhere(args.userId, args.agentId),
    },
    select: { id: true },
  });
  return task?.id ?? null;
}

// Extract every <img> the user can see on the ticket — from the description AND all
// comments — so a mention like "what's wrong in this screenshot?" reaches the model.
// The client only sends the triggering comment's own attachments; description images
// and images posted in earlier comments were previously invisible to HyperAI.
// Returns URL file-parts (the provider fetches them); same access-scoping as above.
// ponytail: capped at 12 images to bound cost; older images drop first.
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

  // HTPR-4459: these URLs come from ticket HTML, which anyone can write — the
  // markdown image rule accepts any remote URL. Handing them on unchecked asks
  // for a fetch of whatever the author names, including http://169.254.169.254
  // and other internal addresses, with the result described back to them.
  // assertSafeWebhookTarget is the guard we already use for webhook targets:
  // https only, no localhost/.local/.internal, and DNS resolved with private and
  // reserved ranges rejected. Checked here rather than at the fetch because the
  // fetch may happen in the model provider, out of our reach.
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
    // Only http(s) URLs the provider can fetch — skip data: URIs and relative src.
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
  const description = htmlToText(task.description_?.content ?? "");
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
    `Description: ${description || "(empty)"}`,
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
