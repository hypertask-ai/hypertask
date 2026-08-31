import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generalConfig } from "@/lib/configs/general.config";
import { broadcastBoardChange } from "@/lib/realtime/server";
import generateRank from "@/utils/generateRank";
import createTaskMovedActivity from "@/utils/controllers/activities/createTaskMovedActivity";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import {
  chooseReviewSectionName,
  extractTicketId,
  verifyGithubSignature,
} from "./github-webhook-helpers";

interface GithubPullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    merged: boolean;
    head: {
      ref: string;
    };
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureIsValid = verifyGithubSignature(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      process.env.GITHUB_WEBHOOK_SECRET,
    );

    if (!signatureIsValid) {
      return NextResponse.json(
        { success: false, error: "Invalid webhook signature" },
        { status: 401 },
      );
    }

    const event = request.headers.get("x-github-event");
    if (event !== "pull_request") {
      return NextResponse.json(
        { success: true, ignored: `Unsupported event: ${event ?? "missing"}` },
        { status: 200 },
      );
    }

    let payload: GithubPullRequestPayload;
    try {
      payload = JSON.parse(rawBody) as GithubPullRequestPayload;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 },
      );
    }

    if (!["opened", "reopened", "closed"].includes(payload.action)) {
      return NextResponse.json(
        { success: true, ignored: `Unsupported action: ${payload.action}` },
        { status: 200 },
      );
    }

    const pullRequest = payload.pull_request;
    const ticketId = extractTicketId({
      title: pullRequest.title,
      headRef: pullRequest.head?.ref,
      body: pullRequest.body,
    });

    if (!ticketId) {
      return NextResponse.json(
        { success: true, ignored: "No ticket reference found" },
        { status: 200 },
      );
    }

    const task = await prisma.task.findFirst({
      where: {
        ticketNumber: ticketId,
        status: { not: "Deleted" },
      },
      select: {
        id: true,
        projectId: true,
        userId: true,
        sectionId: true,
        uniqueIndex: true,
        ticketNumber: true,
        riskLevel: true,
      },
    });

    if (!task) {
      return NextResponse.json(
        { success: true, ticketId, ignored: "Ticket not found" },
        { status: 200 },
      );
    }

    const ticketUrl = `https://app.hypertask.ai/detail/project-${task.projectId}/${task.uniqueIndex}`;
    const escapedTitle = escapeHtml(pullRequest.title);

    let targetSectionName:
      | "AI Review"
      | "Valentin Review"
      | "Done"
      | null = null;
    let commentLead: string;
    let commentText: string;

    if (payload.action === "opened" || payload.action === "reopened") {
      targetSectionName = chooseReviewSectionName(task.riskLevel);
      commentLead = "Pull request opened:";
      commentText = `<p><strong>${commentLead}</strong> <a href="${pullRequest.html_url}">#${pullRequest.number} ${escapedTitle}</a></p><p>Linked to <a href="${ticketUrl}">${ticketId}</a>.</p>`;
    } else if (pullRequest.merged) {
      targetSectionName = "Done";
      commentLead = "Pull request merged:";
      commentText = `<p><strong>${commentLead}</strong> <a href="${pullRequest.html_url}">#${pullRequest.number} ${escapedTitle}</a></p>`;
    } else {
      commentLead = "Pull request closed without merging:";
      commentText = `<p><strong>${commentLead}</strong> <a href="${pullRequest.html_url}">#${pullRequest.number} ${escapedTitle}</a></p>`;
    }

    // ponytail: read-then-write, not a DB unique constraint. Two genuinely
    // concurrent redeliveries of the same event could both pass this check
    // and both post. GitHub redelivers sequentially in practice, so this is
    // accepted; upgrade path if that ever changes is a unique index on
    // (taskId, commentLead-derived key).
    const existingComment = await prisma.comment.findFirst({
      where: {
        taskId: task.id,
        AND: [
          { text: { contains: pullRequest.html_url } },
          { text: { contains: commentLead } },
        ],
      },
      select: { id: true },
    });

    let commented = false;
    if (!existingComment) {
      await createCommentService({
        taskId: task.id,
        ownerId: task.userId,
        creatorId: generalConfig.hyperAiId,
        currentUser: { id: generalConfig.hyperAiId },
        agentId: null,
        text: commentText,
        trustedCaller: true,
      });
      commented = true;
    }

    let moved = false;
    if (targetSectionName) {
      const section = await prisma.section.findFirst({
        where: {
          projectId: task.projectId,
          deleted: false,
          section_title: {
            equals: targetSectionName,
            mode: "insensitive",
          },
        },
      });

      if (!section) {
        console.warn(
          `[GitHub webhook] Board ${task.projectId} has no ${targetSectionName} section; task ${task.id} was not moved.`,
        );
      } else if (section.id !== task.sectionId) {
        const [lastTask, botUser] = await Promise.all([
          prisma.task.findFirst({
            where: { sectionId: section.id, status: "Normal" },
            orderBy: { ranking: "desc" },
            select: { ranking: true },
          }),
          prisma.user.findUnique({
            where: { id: generalConfig.hyperAiId },
            select: {
              id: true,
              email: true,
              displayName: true,
              photoURL: true,
            },
          }),
        ]);

        if (!botUser) {
          throw new Error("HyperAI user not found");
        }

        const currentUser = {
          id: botUser.id,
          email: botUser.email ?? "",
          displayName: botUser.displayName ?? undefined,
          photoURL: botUser.photoURL ?? undefined,
          uid: "",
          stripe_customer_id: "",
          joinedAt: new Date(),
          UserSettingId: "",
          UserSetting: {} as any,
        };
        const ranking = generateRank(lastTask?.ranking, undefined);
        const moveResult = await updateTaskSingle(
          {
            id: task.id,
            sectionId: section.id,
            section: section.section_title,
            ranking,
            updatedAt: new Date(),
          },
          currentUser,
          null,
          // trustedCaller: the signature check above is the gate. currentUser
          // is the synthetic bot, which is on no board.
          { trustedCaller: true },
        );

        if (moveResult.status !== 200) {
          throw new Error("Task move failed");
        }

        moved = true;

        try {
          const moveActivity = moveResult.oldTask?.sectionId != null
            ? await createTaskMovedActivity({
                taskId: task.id,
                toSection_title: section.section_title,
                toSectionId: section.id,
                userObj: currentUser,
                fromSection_title: moveResult.oldTask.section ?? "",
                fromSectionId: moveResult.oldTask.sectionId,
                fromAgent: null,
              })
            : null;
          await Promise.all([
            broadcastBoardChange(task.projectId, {
              originUserId: generalConfig.hyperAiId,
            }),
            moveActivity?.shouldNotify
              ? sendNotificationForTask(
                  generalConfig.hyperAiId,
                  "TaskMoved",
                  task.id,
                  task.projectId,
                  null,
                )
              : Promise.resolve(),
          ]);
        } catch (error) {
          console.warn(
            `[GitHub webhook] Task ${task.id} moved, but a follow-up side effect failed.`,
            error,
          );
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        ticketId,
        commented,
        moved,
        targetSection: targetSectionName,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GitHub webhook] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
