import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { z } from "zod";

import { Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  errorMessage,
  getCurrentUserFromCookies,
  selectTaskWriterModel,
} from "@/app/api/ai/_lib/editorAi";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const suggestReplyRequestSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});

const MAX_DESCRIPTION_CHARS = 6000;
const MAX_COMMENT_CHARS = 1500;
const MAX_COMMENTS = 30;

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(truncated)`;
}

// The comment renderer supports only a small tag set; strip everything else
// and drop all attributes except vetted http(s) links so model output can't
// inject scripts or event handlers into the composer.
const ALLOWED_REPLY_TAGS = new Set([
  "p", "ul", "ol", "li", "strong", "em", "code", "br", "a",
]);

function sanitizeReplyHtml(html: string): string {
  return html
    .replace(
      /<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      ""
    )
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?\s*>/gi, "")
    .replace(/<\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, (match, rawTag: string, attrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_REPLY_TAGS.has(tag)) return "";
      if (match.startsWith("</")) return `</${tag}>`;
      if (tag === "a") {
        const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const url = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
        if (/^https?:\/\//i.test(url)) {
          return `<a href="${url.replace(/"/g, "&quot;")}">`;
        }
        return "<a>";
      }
      return `<${tag}>`;
    });
}

type ReplyContext = Awaited<ReturnType<typeof fetchReplyContext>>;

// Membership is enforced through the project filter — users outside the
// board simply get a 404.
async function fetchReplyContext(taskId: number, userId: number) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      // Suggesting a reply on a closed/archived ticket is a valid flow.
      status: { in: [Status.Normal, Status.Archive] },
      project: getProjectWhere(userId),
    },
    select: {
      title: true,
      description: true,
      section: true,
      ticketNumber: true,
      dueDate: true,
      projectId: true,
      project: { select: { id: true, title: true } },
      assignees: {
        select: {
          user: { select: { displayName: true } },
          agent: { select: { displayName: true } },
        },
      },
      comments: {
        orderBy: { createdAt: "desc" },
        take: MAX_COMMENTS,
        select: {
          commentText: true,
          text: true,
          createdAt: true,
          creator: { select: { displayName: true } },
          agent: { select: { displayName: true } },
        },
      },
    },
  });
}

async function generateSuggestion(task: NonNullable<ReplyContext>, userId: number) {
  const comments = [...task.comments].reverse();
  const commentTranscript = comments.length
    ? comments
        .map((comment) => {
          const author =
            comment.creator?.displayName ??
            comment.agent?.displayName ??
            "Unknown";
          const text = clamp(
            comment.commentText || htmlToPlainText(comment.text),
            MAX_COMMENT_CHARS
          );
          return `[${comment.createdAt.toISOString()}] ${author}: ${text}`;
        })
        .join("\n")
    : "(no comments yet)";

  const assignees = task.assignees
    .map((a) => a.user?.displayName ?? a.agent?.displayName)
    .filter(Boolean)
    .join(", ");

  const prompt = `
You are drafting a reply comment for the current user on the Hypertask task below. Write it from the current user's point of view, as if they were answering the people involved.

TASK
- Title: ${task.title}
${task.ticketNumber ? `- Ticket: ${task.ticketNumber}` : ""}
- Board: ${task.project.title}
- Current status (column): ${task.section || "Unknown"}
${assignees ? `- Assignees: ${assignees}` : "- Assignees: none"}
${task.dueDate ? `- Due date: ${task.dueDate.toISOString().slice(0, 10)}` : ""}

DESCRIPTION
${clamp(htmlToPlainText(task.description), MAX_DESCRIPTION_CHARS) || "(empty)"}

RECENT COMMENTS (oldest first)
${commentTranscript}

INSTRUCTIONS
- Respond to any open questions or requests that are still unanswered, using the latest comments as the source of truth for what has already been said.
- If the thread contains a question directed at the task's participants, answer or acknowledge it concretely; do not just summarize the thread.
- Keep it short: a few sentences at most, or a short list when listing items.
- Return ONLY a valid HTML fragment using <p>, <ul>, <li>, <strong>, and <a> tags. No markdown fences, no greetings like "Sure", no sign-offs, no headings.`;

  const selected = await selectTaskWriterModel({
    projectId: task.projectId,
    userId,
  });
  const { text } = await generateText({
    model: selected.model,
    // Gateway tags (incl. the owning team) ride in providerOptions; without
    // them the shared-allowance middleware rejects the request.
    providerOptions: selected.providerOptions,
    ...selected.settings,
    prompt,
  });

  // Models occasionally wrap output in markdown fences even when told not to.
  const rawHtml = text
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  return sanitizeReplyHtml(rawHtml);
}

export async function POST(request: NextRequest) {
  const cookieUser = await getCurrentUserFromCookies();
  if (!cookieUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let taskId: number;
  try {
    const body = suggestReplyRequestSchema.parse(await request.json());
    taskId = body.taskId;
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid request: ${errorMessage(error)}` },
      { status: 400 }
    );
  }

  try {
    const task = await fetchReplyContext(taskId, cookieUser.id);
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const safeHtml = await generateSuggestion(task, cookieUser.id);

    if (!safeHtml) {
      return NextResponse.json(
        { error: "The model returned an empty suggestion" },
        { status: 502 }
      );
    }

    return NextResponse.json({ html: safeHtml });
  } catch (error) {
    console.error("[ai/suggest-reply] request failed", error);
    return NextResponse.json(
      { error: `Failed to generate suggestion: ${errorMessage(error)}` },
      { status: 500 }
    );
  }
}
