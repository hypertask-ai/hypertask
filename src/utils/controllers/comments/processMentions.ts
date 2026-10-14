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

export async function resolveTextMentions(
  text: string,
  projectId: number,
  requestingUserId: number,
): Promise<string> {
  try {
    if (!text.includes("@")) return text;
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

type MentionDeliveryStage =
  | "follower:user"
  | "email:user"
  | "notification:user"
  | "follower:agent";

export interface ProcessMentionsParams {
  text: string;
  commentId: number;
  taskId: number;
  projectId: number;
  mentionedBy: number;
  fromAgentId?: string | null;
  skipUserIds?: readonly number[];
  failOnError?: boolean;
  deliveryProgress?: {
    has: (stage: MentionDeliveryStage, recipient: number | string) => boolean;
    beforeDelivery: () => Promise<void>;
    mark: (
      stage: MentionDeliveryStage,
      recipient: number | string,
    ) => Promise<void>;
  };
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

export function convertPlainTextMentionsToHtml(
  text: string,
  mentions: McpMention[]
): string {
  if (!mentions?.length) return text;
  let result = text;
  const sorted = [...mentions].sort(
    (a, b) => b.display_name.length - a.display_name.length
  );
  for (const m of sorted) {
    const escaped = m.display_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`@${escaped}\\b`, "gi");
    const escapedDisplayName = escapeHtml(m.display_name);
    const escapedAgentId = escapeHtml(m.agent_id);
    const span = m.agent_id
      ? `<span data-type="mention" class="mention" data-id="${escapedDisplayName}" data-label="agent-${escapedAgentId}">${escapedDisplayName}</span>`
      : taskDetailConfig.urls.templates.mention(m.display_name, m.user_id!);
    result = result.replace(regex, span);
  }
  return result;
}

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
    deliveryProgress,
  } = params;
  const hyperAiId = parseInt(process.env.NEXT_PUBLIC_HYPERAI_ID || "332", 10);

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

    if (!deliveryProgress?.has("follower:user", userId)) {
      await deliveryProgress?.beforeDelivery();
      let delivered = false;
      try {
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
        } else {
          delivered = true;
        }
      } catch (err) {
        console.warn("[processMentions] createFollower failed for user", userId, err);
        errors.push(err);
      }
      if (delivered) await deliveryProgress?.mark("follower:user", userId);
    }

    if (!deliveryProgress?.has("email:user", userId)) {
      await deliveryProgress?.beforeDelivery();
      let delivered = false;
      try {
        delivered =
          !task?.title || !mentionedByActor?.displayName
            ? true
            : await sendMentionEmail(
                userId,
                mentionedByActor.displayName,
                task.title,
                `${baseUrl}/detail/project-${projectId}/${task.uniqueIndex}`,
                "mention",
                text,
                taskId,
              );
        if (!delivered) {
          errors.push(new Error(`Mention email failed for user ${userId}`));
        }
      } catch (err) {
        console.warn("[processMentions] mention email failed for user", userId, err);
        errors.push(err);
      }
      if (delivered) await deliveryProgress?.mark("email:user", userId);
    }

    if (!deliveryProgress?.has("notification:user", userId)) {
      await deliveryProgress?.beforeDelivery();
      let delivered = false;
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
            headers: { Cookie: `${SESSION_COOKIE}=${signSession({ id: mentionedBy }, 60)}` },
          },
        );
        delivered = true;
      } catch (err) {
        console.warn("[processMentions] createMention failed for user", userId, err);
        errors.push(err);
      }
      if (delivered) await deliveryProgress?.mark("notification:user", userId);
    }
  }

  for (const agentIdStr of uniqueAgentMentionIds) {
    if (deliveryProgress?.has("follower:agent", agentIdStr)) continue;
    await deliveryProgress?.beforeDelivery();
    let delivered = false;
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
      } else {
        delivered = true;
      }
    } catch (err) {
      console.warn("[processMentions] createFollower failed for agent", agentIdStr, err);
      errors.push(err);
    }
    if (delivered) await deliveryProgress?.mark("follower:agent", agentIdStr);
  }

  if (failOnError && errors.length > 0) {
    throw new AggregateError(errors, "Mention processing failed");
  }
}
