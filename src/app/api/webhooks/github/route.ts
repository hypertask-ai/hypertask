import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generalConfig } from "@/lib/configs/general.config";
import {
  broadcastBoardChange,
  broadcastTaskChange,
} from "@/lib/realtime/server";
import generateRank from "@/utils/generateRank";
import {
  boardForGithubRepository,
  parseGithubPullRequestUrl,
  type PullRequestLifecycle,
} from "@/lib/pullRequests/githubPullRequests";
import {
  syncCheckSuiteFromWebhook,
  syncPullRequestFromWebhook,
} from "@/lib/pullRequests/syncTaskPullRequests";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import sendNotificationForTask from "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove";
import { updateTaskSingle } from "@/utils/controllers/tasks/single";
import assigneesAssign from "@/utils/controllers/assignees/assign";
import type { IUser } from "@/models/model";
import {
  chooseReviewSectionName,
  extractTicketId,
  verifyGithubSignature,
} from "./github-webhook-helpers";

interface GithubPullRequestPayload {
  action: string;
  repository: {
    id: number;
    full_name: string;
    private: boolean;
    fork: boolean;
  };
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    merged: boolean;
    state: string;
    updated_at: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      repo: {
        id: number;
        full_name: string;
      };
    };
  };
}

interface GithubCheckSuitePayload {
  action: string;
  repository: {
    full_name: string;
    private: boolean;
    fork: boolean;
  };
  check_suite: {
    app: { id: number; name: string };
    head_sha: string;
    status: string;
    conclusion: string | null;
    updated_at: string;
    pull_requests: Array<{
      number: number;
      base: { repo: { full_name: string } };
    }>;
  };
}

type WebhookTask = {
  id: number;
  projectId: number;
  userId: number;
  sectionId: number | null;
  riskLevel: "Low" | "Medium" | "High" | null;
};

const MERGED_PULL_REQUEST_SECTION = "QA" as const;
type PullRequestTargetSection =
  | ReturnType<typeof chooseReviewSectionName>
  | typeof MERGED_PULL_REQUEST_SECTION
  | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function repositoryParts(fullName: unknown) {
  if (typeof fullName !== "string") return null;
  const [owner, repository, ...extra] = fullName.toLowerCase().split("/");
  return owner && repository && extra.length === 0
    ? { owner, repository }
    : null;
}

type PullRequestMoveResult = {
  moved: boolean;
  targetReached: boolean;
  targetSectionId: number | null;
  actor: IUser | null;
};

async function githubWebhookActor(): Promise<IUser> {
  const botUser = await prisma.user.findUnique({
    where: { id: generalConfig.hyperAiId },
    select: {
      id: true,
      email: true,
      displayName: true,
      photoURL: true,
    },
  });
  if (!botUser) throw new Error("HyperAI user not found");

  return {
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
}

async function moveTaskForPullRequest(
  task: WebhookTask,
  targetSectionName: PullRequestTargetSection,
): Promise<PullRequestMoveResult> {
  const notReached = {
    moved: false,
    targetReached: false,
    targetSectionId: null,
    actor: null,
  };
  if (!targetSectionName) return notReached;
  const section = await prisma.section.findFirst({
    where: {
      projectId: task.projectId,
      deleted: false,
      section_title: { equals: targetSectionName, mode: "insensitive" },
    },
  });
  if (!section) {
    console.warn(
      `[GitHub webhook] Board ${task.projectId} has no ${targetSectionName} section; task ${task.id} was not moved.`,
    );
    return notReached;
  }

  if (section.id === task.sectionId) {
    return {
      moved: false,
      targetReached: true,
      targetSectionId: section.id,
      actor: null,
    };
  }

  const [lastTask, actor] = await Promise.all([
    prisma.task.findFirst({
      where: { sectionId: section.id, status: "Normal" },
      orderBy: { ranking: "desc" },
      select: { ranking: true },
    }),
    githubWebhookActor(),
  ]);
  const moveResult = await updateTaskSingle(
    {
      id: task.id,
      sectionId: section.id,
      section: section.section_title,
      ranking: generateRank(lastTask?.ranking, undefined),
      updatedAt: new Date(),
    },
    actor,
    null,
    {
      trustedCaller: true,
      taskMovedActivity: {
        sendNotification: () =>
          sendNotificationForTask(
            generalConfig.hyperAiId,
            "TaskMoved",
            task.id,
            task.projectId,
            null,
          ),
      },
    },
  );
  if (moveResult.status === 409) {
    // The PR link is already durable. The active writer owns the task's next
    // section; failing here only produces manual redeliveries and duplicate comments.
    console.warn(
      `[GitHub webhook] Task ${task.id} has an active write; its automatic move to ${targetSectionName} was skipped.`,
    );
    return { ...notReached, actor };
  }
  if (moveResult.status !== 200) throw new Error("Task move failed");
  return {
    moved: true,
    targetReached: true,
    targetSectionId: section.id,
    actor,
  };
}

async function reconcileMergedPullRequestAssignees(
  task: WebhookTask,
  moveResult: PullRequestMoveResult,
): Promise<boolean> {
  if (!moveResult.targetReached || moveResult.targetSectionId == null) {
    return false;
  }

  const [currentTask, qaSection] = await Promise.all([
    prisma.task.findUnique({
      where: { id: task.id },
      select: { projectId: true, sectionId: true, status: true },
    }),
    prisma.section.findUnique({
      where: { id: moveResult.targetSectionId },
      select: {
        projectId: true,
        deleted: true,
        section_title: true,
        autoAssignAgentId: true,
      },
    }),
  ]);
  if (
    !currentTask ||
    currentTask.status !== "Normal" ||
    currentTask.projectId !== task.projectId ||
    currentTask.sectionId !== moveResult.targetSectionId ||
    !qaSection ||
    qaSection.deleted ||
    qaSection.projectId !== task.projectId ||
    qaSection.section_title.toLowerCase() !==
      MERGED_PULL_REQUEST_SECTION.toLowerCase()
  ) {
    return false;
  }

  const qaAgentId = qaSection.autoAssignAgentId;
  if (!qaAgentId) {
    console.warn(
      `[GitHub webhook] QA section ${qaSection.section_title} has no agent auto-assignee; task ${task.id} assignments were not changed.`,
    );
    return false;
  }

  const actor = moveResult.actor ?? (await githubWebhookActor());
  const mutationOptions = {
    expectedProjectId: task.projectId,
    expectedSectionId: moveResult.targetSectionId,
    allowHumanOverride: false,
  };
  const qaAssignment = await assigneesAssign(
    actor,
    null,
    task.id,
    qaAgentId,
    undefined,
    { ...mutationOptions, intent: "assign" },
  );
  if (qaAssignment.status === 409) {
    console.warn(
      `[GitHub webhook] Task ${task.id} has an active write; its QA assignment cleanup was skipped.`,
    );
    return false;
  }
  if (qaAssignment.status !== 200) {
    throw new Error("QA agent assignment failed");
  }

  const outgoingAgentAssignments = await prisma.assignees.findMany({
    where: { taskId: task.id, agentId: { not: null } },
    select: { userId: true, agentId: true },
  });
  let changed =
    "assignmentOutcome" in qaAssignment.json &&
    qaAssignment.json.assignmentOutcome === "created";
  for (const assignment of outgoingAgentAssignments) {
    if (!assignment.agentId || assignment.agentId === qaAgentId) continue;
    const removal = await assigneesAssign(
      actor,
      assignment.userId,
      task.id,
      assignment.agentId,
      undefined,
      { ...mutationOptions, intent: "unassign" },
    );
    if (removal.status === 409) {
      console.warn(
        `[GitHub webhook] Task ${task.id} changed during QA assignment cleanup; remaining agent assignments were preserved.`,
      );
      return changed;
    }
    if (removal.status !== 200) {
      throw new Error("Outgoing agent unassignment failed");
    }
    changed = true;
  }
  return changed;
}

function invalidPayload(message: string) {
  return NextResponse.json(
    { success: false, error: message },
    { status: 400 },
  );
}

async function broadcastPullRequestChanges(
  boardId: number,
  taskIds: Iterable<number>,
): Promise<void> {
  const results = await Promise.allSettled([
    broadcastBoardChange(boardId, {
      originUserId: generalConfig.hyperAiId,
    }),
    ...[...taskIds].map((taskId) =>
      broadcastTaskChange(taskId, {
        originUserId: generalConfig.hyperAiId,
      }),
    ),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[GitHub webhook] Realtime delivery failed", result.reason);
    }
  }
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
    if (event !== "pull_request" && event !== "check_suite") {
      return NextResponse.json(
        { success: true, ignored: `Unsupported event: ${event ?? "missing"}` },
        { status: 200 },
      );
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(rawBody);
    } catch {
      return invalidPayload("Invalid JSON payload");
    }
    if (!isRecord(parsedPayload) || !isRecord(parsedPayload.repository)) {
      return invalidPayload("Invalid webhook payload");
    }

    const payload = parsedPayload as unknown as
      | GithubPullRequestPayload
      | GithubCheckSuitePayload;
    const repositoryFullName = payload.repository.full_name;
    const boardId = boardForGithubRepository({
      fullName: repositoryFullName,
      isPrivate: payload.repository?.private,
      isFork: payload.repository?.fork,
    });
    const repository = repositoryParts(repositoryFullName);
    if (!boardId || !repository) {
      return NextResponse.json({
        success: true,
        ignored: "Repository is not configured for a board",
      });
    }

    if (event === "check_suite") {
      const rawSuite = parsedPayload.check_suite;
      if (
        !isRecord(rawSuite) ||
        !isRecord(rawSuite.app) ||
        typeof rawSuite.app.id !== "number" ||
        typeof rawSuite.app.name !== "string" ||
        typeof rawSuite.head_sha !== "string" ||
        typeof rawSuite.status !== "string" ||
        (rawSuite.conclusion !== null &&
          typeof rawSuite.conclusion !== "string") ||
        typeof rawSuite.updated_at !== "string" ||
        !Array.isArray(rawSuite.pull_requests) ||
        !rawSuite.pull_requests.every(
          (pullRequest) =>
            isRecord(pullRequest) &&
            Number.isInteger(pullRequest.number) &&
            isRecord(pullRequest.base) &&
            isRecord(pullRequest.base.repo) &&
            typeof pullRequest.base.repo.full_name === "string",
        )
      ) {
        return invalidPayload("Invalid check suite payload");
      }
    } else {
      const rawPullRequest = parsedPayload.pull_request;
      if (
        !isRecord(rawPullRequest) ||
        !Number.isInteger(rawPullRequest.id) ||
        !Number.isInteger(rawPullRequest.number) ||
        typeof rawPullRequest.title !== "string" ||
        (rawPullRequest.body !== null &&
          typeof rawPullRequest.body !== "string") ||
        typeof rawPullRequest.html_url !== "string" ||
        typeof rawPullRequest.merged !== "boolean" ||
        typeof rawPullRequest.state !== "string" ||
        typeof rawPullRequest.updated_at !== "string" ||
        !isRecord(rawPullRequest.head) ||
        typeof rawPullRequest.head.ref !== "string" ||
        typeof rawPullRequest.head.sha !== "string" ||
        !isRecord(rawPullRequest.base) ||
        !isRecord(rawPullRequest.base.repo) ||
        !Number.isInteger(rawPullRequest.base.repo.id) ||
        typeof rawPullRequest.base.repo.full_name !== "string"
      ) {
        return invalidPayload("Invalid pull request payload");
      }
    }

    if (event === "check_suite") {
      const checkPayload = payload as GithubCheckSuitePayload;
      if (
        !["requested", "rerequested", "completed"].includes(
          checkPayload.action,
        )
      ) {
        return NextResponse.json({
          success: true,
          ignored: `Unsupported action: ${checkPayload.action}`,
        });
      }
      const suite = checkPayload.check_suite;
      const sourceUpdatedAt = new Date(suite.updated_at);
      if (
        !suite.app?.id ||
        !suite.head_sha ||
        !suite.status ||
        Number.isNaN(sourceUpdatedAt.getTime())
      ) {
        return invalidPayload("Invalid check suite payload");
      }

      const pullRequestNumbers = [
        ...new Set(
          (suite.pull_requests ?? [])
            .filter(
              (pullRequest) =>
                pullRequest.base?.repo?.full_name?.toLowerCase() ===
                  repositoryFullName.toLowerCase() &&
                Number.isInteger(pullRequest.number),
            )
            .map((pullRequest) => pullRequest.number),
        ),
      ];
      const syncResults = await Promise.all(
        pullRequestNumbers.map((number) =>
          syncCheckSuiteFromWebhook({
            repositoryOwner: repository.owner,
            repositoryName: repository.repository,
            number,
            githubAppId: String(suite.app.id),
            appName: suite.app.name,
            headSha: suite.head_sha,
            status: suite.status,
            conclusion: suite.conclusion,
            sourceUpdatedAt,
          }),
        ),
      );
      const taskIds = new Set<number>();
      let updated = 0;
      for (const result of syncResults) {
        updated += result.updated;
        result.taskIds.forEach((taskId) => taskIds.add(taskId));
      }
      if (updated > 0) {
        await broadcastPullRequestChanges(boardId, taskIds);
      }
      return NextResponse.json({
        success: true,
        updated,
        taskIds: [...taskIds],
      });
    }

    const pullRequestPayload = payload as GithubPullRequestPayload;
    if (
      !["opened", "reopened", "synchronize", "closed"].includes(
        pullRequestPayload.action,
      )
    ) {
      return NextResponse.json({
        success: true,
        ignored: `Unsupported action: ${pullRequestPayload.action}`,
      });
    }

    const pullRequest = pullRequestPayload.pull_request;
    const sourceUpdatedAt = new Date(pullRequest.updated_at);
    const parsedUrl = parseGithubPullRequestUrl(pullRequest.html_url);
    if (
      pullRequest.base?.repo?.full_name.toLowerCase() !==
        repositoryFullName.toLowerCase() ||
      String(pullRequest.base.repo.id) !== String(pullRequestPayload.repository.id) ||
      !parsedUrl ||
      parsedUrl.owner !== repository.owner ||
      parsedUrl.repository !== repository.repository ||
      parsedUrl.number !== pullRequest.number ||
      !Number.isInteger(pullRequest.number) ||
      !pullRequest.head?.sha ||
      Number.isNaN(sourceUpdatedAt.getTime())
    ) {
      return invalidPayload("Invalid pull request payload");
    }

    const board = await prisma.project.findUnique({
      where: { id: boardId },
      select: { uniqueIdentifier: true },
    });
    if (!board?.uniqueIdentifier) {
      console.error(
        `[GitHub webhook] Board ${boardId} has no ticket identifier; event was ignored.`,
      );
      return NextResponse.json({
        success: true,
        ignored: "Repository board has no ticket identifier",
      });
    }

    const ticketId = extractTicketId({
      boardPrefix: board.uniqueIdentifier,
      title: pullRequest.title,
      headRef: pullRequest.head?.ref,
      body: pullRequest.body,
    });
    const lifecycle: PullRequestLifecycle = pullRequest.merged
      ? "merged"
      : pullRequest.state === "closed"
        ? "closed"
        : "open";
    const syncResult = await syncPullRequestFromWebhook({
      boardId,
      ticketNumber: ticketId,
      repositoryOwner: repository.owner,
      repositoryName: repository.repository,
      repositoryId: String(pullRequestPayload.repository.id),
      pullRequestId: String(pullRequest.id),
      number: pullRequest.number,
      url: pullRequest.html_url,
      title: pullRequest.title,
      lifecycle,
      headSha: pullRequest.head.sha,
      sourceUpdatedAt,
      action: pullRequestPayload.action as
        | "opened"
        | "reopened"
        | "synchronize"
        | "closed",
      actorUserId: generalConfig.hyperAiId,
    });

    if (syncResult.taskIds.length > 0) {
      const tasks = await prisma.task.findMany({
        where: { id: { in: syncResult.taskIds }, status: { not: "Deleted" } },
        select: {
          id: true,
          projectId: true,
          userId: true,
          sectionId: true,
          riskLevel: true,
        },
      });
      let moved = 0;
      let assignmentsChanged = false;
      for (const task of tasks) {
        let targetSectionName: PullRequestTargetSection = null;
        if (
          pullRequestPayload.action === "opened" ||
          pullRequestPayload.action === "reopened"
        ) {
          targetSectionName = chooseReviewSectionName(task.riskLevel);
        } else if (pullRequest.merged) {
          targetSectionName = MERGED_PULL_REQUEST_SECTION;
        }
        const moveResult = await moveTaskForPullRequest(task, targetSectionName);
        if (moveResult.moved) moved += 1;
        if (pullRequest.merged) {
          assignmentsChanged =
            (await reconcileMergedPullRequestAssignees(task, moveResult)) ||
            assignmentsChanged;
        }
      }
      if (
        syncResult.linked > 0 ||
        syncResult.updated > 0 ||
        moved > 0 ||
        assignmentsChanged
      ) {
        await broadcastPullRequestChanges(boardId, syncResult.taskIds);
      }
      return NextResponse.json({
        success: true,
        ticketId,
        linked: syncResult.linked,
        updated: syncResult.updated,
        moved,
      });
    }

    if (!["opened", "reopened", "closed"].includes(payload.action)) {
      return NextResponse.json(
        { success: true, ignored: `Unsupported action: ${payload.action}` },
        { status: 200 },
      );
    }

    if (!ticketId) {
      return NextResponse.json(
        { success: true, ignored: "No ticket reference found" },
        { status: 200 },
      );
    }

    // Legacy ticket handling remains below for repositories whose PR could not
    // be linked to a task by the first-class synchronization path.
    if (!ticketId) {
      return NextResponse.json(
        { success: true, ignored: "No ticket reference found" },
        { status: 200 },
      );
    }

    const task = await prisma.task.findFirst({
      where: {
        projectId: boardId,
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

    let targetSectionName: PullRequestTargetSection = null;
    let commentLead: string;
    let commentText: string;

    if (payload.action === "opened" || payload.action === "reopened") {
      targetSectionName = chooseReviewSectionName(task.riskLevel);
      commentLead = "Pull request opened:";
      commentText = `<p><strong>${commentLead}</strong> <a href="${pullRequest.html_url}">#${pullRequest.number} ${escapedTitle}</a></p><p>Linked to <a href="${ticketUrl}">${ticketId}</a>.</p>`;
    } else if (pullRequest.merged) {
      targetSectionName = MERGED_PULL_REQUEST_SECTION;
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

    const moveResult = await moveTaskForPullRequest(task, targetSectionName);
    const moved = moveResult.moved;
    const assignmentsChanged = pullRequest.merged
      ? await reconcileMergedPullRequestAssignees(task, moveResult)
      : false;
    if (moved || assignmentsChanged) {
      try {
        await broadcastBoardChange(task.projectId, {
          originUserId: generalConfig.hyperAiId,
        });
      } catch (error) {
        console.warn(
          `[GitHub webhook] Task ${task.id} changed, but a follow-up side effect failed.`,
          error,
        );
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
