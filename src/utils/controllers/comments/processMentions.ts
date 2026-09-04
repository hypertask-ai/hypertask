/**
 * Processes mentions from comment text - creates notifications and adds users as followers.
 * Used by both UI (via comments create API) and MCP comments API.
 * Extracts user IDs from HTML mention spans and triggers createMention + createFollower for each.
 */
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import { shouldSkipMentionRecipient } from "./mentionRecipients";
import { extractTipTapContent, stripBlockquoteContent } from "@/utils/helperFunctions/multiPages/multipages.functions";
import axios from "axios";
import { sendMentionEmail } from "../notifications/sendMentionEmail";
import prisma from "@/lib/prisma";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import { injectMentionSpans, type ResolvableMember } from "./resolveMentions";
import { escapeHtml } from "@/utils/htmlEscape";
import { createFollowerService } from "@/utils/controllers/followers/createFollowerService";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

/**
 * Resolves plain "@Name" / "@<id>" tokens in comment text against the project's
 * members and rewrites them as mention spans, so CLI/MCP callers don't have to
 * hand-write the markup (HTPR-3783). The existing extraction pipeline then
 * notifies as usual. Returns the original text unchanged on any lookup failure.
 */
export async function resolveTextMentions(
  text: string,
  projectId: number,
  requestingUserId: number,
): Promise<string> {
  try {
    if (!text.includes("@")) return text; // nothing to resolve, skip the query
    const { members } = await getProjectMembers(
      projectId,
      undefined,
      requestingUserId,
    );
    if (!members?.length) return text;
    const resolvable: ResolvableMember[] = members.map((m) => ({
      id: m.id,
      displayName: m.displayName,
    }));
    return injectMentionSpans(text, resolvable);
  } catch (err) {
    console.warn("[resolveTextMentions] failed, leaving text as-is:", err);
    return text;
  }
}

const getBaseUrl = () =>
  process.env.NEXT_PUBLIC_BASEURL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export interface ProcessMentionsParams {
  text: string;
  commentId: number;
  taskId: number;
  projectId: number;
  mentionedBy: number;
  fromAgentId?: string | null;
  /** Mentions already delivered through a stronger direct-reply notification. */
  skipUserIds?: readonly number[];
  failOnError?: boolean;
}

export interface McpMention {
  user_id?: number;
  agent_id?: string;
  display_name: string;
}

export function getMentionedUserIdsFromCommentText(text: string): number[] {
  const { mentions } = extractTipTapContent(text);

  return [...new Set(mentions)]
    .map((userId) => parseInt(userId, 10))
    .filter(Number.isInteger);
}

export function getMentionedAgentIdsFromCommentText(text: string): string[] {
  const mentionSource = stripBlockquoteContent(text);
  const { agentMentions } = extractTipTapContent(mentionSource);
  return [...new Set(agentMentions)];
}

/**
 * Converts plain text @mentions to HTML span format for MCP.
 * Replaces @display_name with proper mention spans when mentions array is provided.
 * Uses longest-match first to avoid partial replacements (e.g. "John" vs "John Doe").
 */
export function convertPlainTextMentionsToHtml(
  text: string,
  mentions: McpMention[]
): string {
  if (!mentions?.length) return text;
  let result = text;
  // Sort by display_name length descending so "John Doe" is replaced before "John"
  const sorted = [...mentions].sort(
    (a, b) => b.display_name.length - a.display_name.length
  );
  for (const m of sorted) {
    const escaped = m.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`@${escaped}\\b`, "gi");
    // SECURITY: Preserve staging HTML escaping and the PR's stricter agent-id attribute escaping for MCP-generated mention spans.
    const escapedDisplayName = escapeHtml(m.display_name);
    const escapedAgentId = escapeHtml(m.agent_id);
    const span = m.agent_id
      ? `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="agent-${escapedAgentId}">${escapedDisplayName}</span>`
      : taskDetailConfig.urls.templates.mention(m.display_name, m.user_id!);
    result = result.replace(regex, span);
  }
  return result;
}

/**
 * Extracts mentions from HTML content and creates notifications + adds followers.
 * Skips HyperAI, and the creator unless an agent posted (see
 * shouldSkipMentionRecipient).
 */
export async function processMentionsFromCommentText(params: ProcessMentionsParams): Promise<void> {
  const {
    text,
    commentId,
    taskId,
    projectId,
    mentionedBy,
    fromAgentId,
    skipUserIds = [],
    failOnError = false,
  } = params;
  const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332", 10);

  // Strip quoted (<blockquote>) content before extracting mentions: a mention
  // inside a quoted reply must not re-notify the user or re-trigger the agent
  // (agents otherwise loop, replying to their own quoted mention). The original
  // `text` is kept intact for the email body below.
  const mentionSource = stripBlockquoteContent(text);
  const uniqueMentionIds = getMentionedUserIdsFromCommentText(mentionSource);
  const uniqueAgentMentionIds = getMentionedAgentIdsFromCommentText(mentionSource);
  const skippedUsers = new Set(skipUserIds);
  const errors: unknown[] = [];

  const baseUrl = getBaseUrl();

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { title: true, uniqueIndex: true },
  });

  const mentionedByActor = fromAgentId
    ? await prisma.agent.findUnique({
        where: { id: fromAgentId },
        select: { displayName: true },
      })
    : await prisma.user.findUnique({
        where: { id: mentionedBy },
        select: { displayName: true },
      });

  for (const userId of uniqueMentionIds) {
    if (skippedUsers.has(userId)) continue;
    if (shouldSkipMentionRecipient({ userId, mentionedBy, hyperAiId, fromAgentId })) continue;

    try {
      // Add user as follower (if not already assignee)
      const result = await createFollowerService({
        userId,
        taskId,
        mentionById: mentionedBy,
      });

      if (result.status !== 200 && result.status !== 201) {
        console.warn(
          "[processMentions] createFollower failed for user",
          userId,
          result.body,
        );
        errors.push(new Error(`Mention follower failed for user ${userId}`));
      } else if (task?.title && mentionedByActor?.displayName) {
        const sent = await sendMentionEmail(
          userId,
          mentionedByActor.displayName,
          task.title,
          `${baseUrl}/detail/project-${projectId}/${task.uniqueIndex}`,
          "mention",
          text,
          taskId
        );
        if (!sent) errors.push(new Error(`Mention email failed for user ${userId}`));
      }
    } catch (err) {
      console.warn("[processMentions] createFollower failed for user", userId, err);
      errors.push(err);
    }

    try {
      await axios.post(
        `${baseUrl}/api/comments/createMention`,
        {
          userId,
          taskId,
          commentId,
          projectId,
          ...(fromAgentId ? { fromAgentId } : {}),
        },
        {
          // HTPR-4667: present the trusted server-side actor as a signed session.
          headers: { Cookie: `${SESSION_COOKIE}=${signSession({ id: mentionedBy }, 60)}` },
        },
      );
    } catch (err) {
      console.warn("[processMentions] createMention failed for user", userId, err);
      errors.push(err);
    }

  }

  for (const agentIdStr of uniqueAgentMentionIds) {
    try {
      const result = await createFollowerService({
        taskId,
        mentionById: mentionedBy,
        agentId: agentIdStr,
        commentId,
        ...(fromAgentId ? { fromAgentId } : {}),
      });

      if (result.status !== 200 && result.status !== 201) {
        console.warn(
          "[processMentions] createFollower failed for agent",
          agentIdStr,
          result.body,
        );
        errors.push(new Error(`Mention follower failed for agent ${agentIdStr}`));
      }
    } catch (err) {
      console.warn("[processMentions] createFollower failed for agent", agentIdStr, err);
      errors.push(err);
    }
  }

  if (failOnError && errors.length > 0) {
    throw new AggregateError(errors, "Mention processing failed");
  }
}
