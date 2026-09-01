import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sanitizeAgentCredentials } from "@/lib/agents/publicAgent";
import { taskWriteAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  assertAgentAssignmentChangeAllowed,
  cancelAgentMutationLeaseForHumanOverride,
} from "@/lib/mcp/tasks/agentMutationFence";
import {
  derivePullRequestDisplayState,
  parseGithubPullRequestUrl,
  type ParsedGithubPullRequestUrl,
  type PullRequestCheckState,
  type PullRequestLifecycle,
} from "./githubPullRequests";

export class PullRequestLinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "PullRequestLinkError";
  }
}

interface GithubPullRequestMetadata {
  repositoryId: string;
  pullRequestId: string;
  title: string;
  lifecycle: PullRequestLifecycle;
  headSha: string;
  sourceUpdatedAt: Date;
}

export interface PublicTaskPullRequest {
  id: string;
  repositoryOwner: string;
  repositoryName: string;
  number: number;
  url: string;
  title: string;
  lifecycle: PullRequestLifecycle;
  checkState: PullRequestCheckState;
  displayState: ReturnType<typeof derivePullRequestDisplayState>;
  headSha: string | null;
  updatedAt: Date;
}

interface LinkTaskPullRequestInput {
  taskId: number;
  userId: number;
  agentId?: string | null;
  url: string;
  fetchMetadata?: (
    parsed: ParsedGithubPullRequestUrl,
  ) => Promise<GithubPullRequestMetadata>;
  db?: typeof prisma;
}

const pullRequestSelect = {
  id: true,
  repositoryOwner: true,
  repositoryName: true,
  number: true,
  url: true,
  title: true,
  lifecycle: true,
  checkState: true,
  headSha: true,
  updatedAt: true,
} satisfies Prisma.TaskPullRequestSelect;

export function toPublicTaskPullRequest(
  pullRequest: Prisma.TaskPullRequestGetPayload<{
    select: typeof pullRequestSelect;
  }>,
): PublicTaskPullRequest {
  const lifecycle = pullRequest.lifecycle as PullRequestLifecycle;
  const checkState = pullRequest.checkState as PullRequestCheckState;
  return {
    ...pullRequest,
    lifecycle,
    checkState,
    displayState: derivePullRequestDisplayState(lifecycle, checkState),
  };
}

function githubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Hypertask-Pull-Request-Linker",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchGithubPullRequest(
  parsed: ParsedGithubPullRequestUrl,
): Promise<GithubPullRequestMetadata> {
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}`,
    { headers: githubHeaders(), cache: "no-store" },
  );

  if (response.status === 404) {
    throw new PullRequestLinkError("Pull request not found", 404, "pr_not_found");
  }
  if (!response.ok) {
    throw new PullRequestLinkError(
      "GitHub could not verify this pull request",
      502,
      "github_unavailable",
    );
  }

  const value = (await response.json()) as Record<string, any>;
  const updatedAt = new Date(value.updated_at);
  if (
    String(value.html_url).toLowerCase() !== parsed.url ||
    !value.base?.repo?.id ||
    !value.id ||
    typeof value.title !== "string" ||
    typeof value.head?.sha !== "string" ||
    Number.isNaN(updatedAt.getTime())
  ) {
    throw new PullRequestLinkError(
      "GitHub returned invalid pull request metadata",
      502,
      "invalid_github_response",
    );
  }

  return {
    repositoryId: String(value.base.repo.id),
    pullRequestId: String(value.id),
    title: value.title,
    lifecycle: value.merged_at
      ? "merged"
      : value.state === "closed"
        ? "closed"
        : "open",
    headSha: value.head.sha,
    sourceUpdatedAt: updatedAt,
  };
}

export async function linkTaskPullRequest({
  taskId,
  userId,
  agentId = null,
  url,
  fetchMetadata = fetchGithubPullRequest,
  db = prisma,
}: LinkTaskPullRequestInput): Promise<{
  created: boolean;
  pullRequest: PublicTaskPullRequest;
}> {
  const parsed = parseGithubPullRequestUrl(url);
  if (!parsed) {
    throw new PullRequestLinkError(
      "Use a full GitHub pull request URL",
      400,
      "invalid_pr_url",
    );
  }

  const authorizedTask = await db.task.findFirst({
    where: {
      id: taskId,
      status: { not: "Deleted" },
      project: taskWriteAccessWhere(userId, agentId),
    },
    select: { id: true },
  });
  if (!authorizedTask) {
    throw new PullRequestLinkError(
      "Task not found or access denied",
      404,
      "task_not_found",
    );
  }

  const existing = await db.taskPullRequest.findUnique({
    where: {
      taskId_repositoryOwner_repositoryName_number: {
        taskId,
        repositoryOwner: parsed.owner,
        repositoryName: parsed.repository,
        number: parsed.number,
      },
    },
    select: pullRequestSelect,
  });
  if (existing) {
    return { created: false, pullRequest: toPublicTaskPullRequest(existing) };
  }

  const metadata = await fetchMetadata(parsed);

  try {
    return await db.$transaction(async (transaction) => {
      const task = await transaction.task.findFirst({
        where: {
          id: taskId,
          status: { not: "Deleted" },
          project: taskWriteAccessWhere(userId, agentId),
        },
        select: { id: true, updatedByUserIds: true },
      });
      if (!task) {
        throw new PullRequestLinkError(
          "Task not found or access denied",
          404,
          "task_not_found",
        );
      }

      const identity = {
        taskId_repositoryOwner_repositoryName_number: {
          taskId,
          repositoryOwner: parsed.owner,
          repositoryName: parsed.repository,
          number: parsed.number,
        },
      };
      const existing = await transaction.taskPullRequest.findUnique({
        where: identity,
        select: pullRequestSelect,
      });
      if (existing) {
        return { created: false, pullRequest: toPublicTaskPullRequest(existing) };
      }

      const [user, agent] = await Promise.all([
        transaction.user.findUnique({
          where: { id: userId },
          select: { id: true, displayName: true, photoURL: true, email: true },
        }),
        agentId
          ? transaction.agent.findFirst({
              where: { id: agentId, userId, revokedAt: null },
              select: { id: true, userId: true, displayName: true, photoURL: true },
            })
          : null,
      ]);
      if (!user || (agentId && !agent)) {
        throw new PullRequestLinkError("Unauthorized", 401, "unauthorized");
      }

      await assertAgentAssignmentChangeAllowed(
        transaction,
        taskId,
        agentId,
        userId,
        { allowHumanOverride: !agentId },
      );
      if (!agentId) {
        await cancelAgentMutationLeaseForHumanOverride(
          transaction,
          taskId,
          userId,
        );
      }

      const created = await transaction.taskPullRequest.create({
        data: {
          taskId,
          repositoryOwner: parsed.owner,
          repositoryName: parsed.repository,
          githubRepositoryId: metadata.repositoryId,
          githubPullRequestId: metadata.pullRequestId,
          number: parsed.number,
          url: parsed.url,
          title: metadata.title,
          lifecycle: metadata.lifecycle,
          checkState: "pending",
          headSha: metadata.headSha,
          sourceUpdatedAt: metadata.sourceUpdatedAt,
        },
        select: pullRequestSelect,
      });

      const activity = sanitizeAgentCredentials({
        type: "TaskPullRequest",
        data: {
          fromUserId: userId,
          fromUser: user,
          fromAgent: agent,
          action: "linked",
          pullRequest: {
            url: created.url,
            title: created.title,
            number: created.number,
            repository: `${created.repositoryOwner}/${created.repositoryName}`,
            displayState: derivePullRequestDisplayState(
              metadata.lifecycle,
              "pending",
            ),
          },
        },
      });
      await transaction.comment.create({
        data: {
          text: "",
          taskId,
          agentId: agent?.id ?? null,
          activity: activity as Prisma.InputJsonValue,
        },
      });

      if (!task.updatedByUserIds.includes(userId)) {
        await transaction.task.update({
          where: { id: taskId },
          data: {
            updatedAt: new Date(),
            updatedByUserIds: { push: userId },
          },
        });
      }

      return { created: true, pullRequest: toPublicTaskPullRequest(created) };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.taskPullRequest.findUnique({
        where: {
          taskId_repositoryOwner_repositoryName_number: {
            taskId,
            repositoryOwner: parsed.owner,
            repositoryName: parsed.repository,
            number: parsed.number,
          },
        },
        select: pullRequestSelect,
      });
      if (existing) {
        return { created: false, pullRequest: toPublicTaskPullRequest(existing) };
      }
    }
    throw error;
  }
}

export { pullRequestSelect };
