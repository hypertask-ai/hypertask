import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { sanitizeAgentCredentials } from "@/lib/agents/publicAgent";
import {
  checkStateFromSuites,
  derivePullRequestDisplayState,
  isStaleCheckSuiteObservation,
  type PullRequestCheckState,
  type PullRequestDisplayState,
  type PullRequestLifecycle,
} from "./githubPullRequests";

interface PullRequestWebhookUpdate {
  boardId: number;
  ticketNumber?: string | null;
  repositoryOwner: string;
  repositoryName: string;
  repositoryId: string;
  pullRequestId: string;
  number: number;
  url: string;
  title: string;
  lifecycle: PullRequestLifecycle;
  headSha: string;
  sourceUpdatedAt: Date;
  action: "opened" | "reopened" | "synchronize" | "closed";
  actorUserId: number;
}

interface CheckSuiteWebhookUpdate {
  repositoryOwner: string;
  repositoryName: string;
  number: number;
  githubAppId: string;
  appName: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  sourceUpdatedAt: Date;
}

type Transaction = Prisma.TransactionClient;

async function writePullRequestActivity(
  transaction: Transaction,
  input: {
    taskId: number;
    actor?: {
      id: number;
      displayName: string | null;
      photoURL: string | null;
      email: string | null;
    } | null;
    action: "linked" | "state_changed" | "closed";
    pullRequest: {
      url: string;
      title: string;
      number: number;
      repository: string;
      displayState: PullRequestDisplayState;
    };
  },
) {
  const activity = sanitizeAgentCredentials({
    type: "TaskPullRequest",
    data: {
      ...(input.actor
        ? { fromUserId: input.actor.id, fromUser: input.actor }
        : {}),
      action: input.action,
      pullRequest: input.pullRequest,
    },
  });
  await transaction.comment.create({
    data: {
      text: "",
      taskId: input.taskId,
      activity: activity as Prisma.InputJsonValue,
    },
  });
}

export async function syncPullRequestFromWebhook(
  input: PullRequestWebhookUpdate,
): Promise<{ linked: number; updated: number; taskIds: number[] }> {
  return prisma.$transaction(async (transaction) => {
    const existingLinks = await transaction.taskPullRequest.findMany({
      where: {
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        number: input.number,
        task: {
          projectId: input.boardId,
          status: { not: "Deleted" },
        },
      },
      select: { taskId: true },
    });

    let taskIds = [...new Set(existingLinks.map((link) => link.taskId))];
    if (taskIds.length === 0) {
      const globallyLinked = await transaction.taskPullRequest.findUnique({
        where: {
          repositoryOwner_repositoryName_number: {
            repositoryOwner: input.repositoryOwner,
            repositoryName: input.repositoryName,
            number: input.number,
          },
        },
        select: { id: true },
      });
      if (globallyLinked) return { linked: 0, updated: 0, taskIds: [] };
    }
    if (taskIds.length === 0 && input.ticketNumber) {
      const task = await transaction.task.findFirst({
        where: {
          projectId: input.boardId,
          ticketNumber: input.ticketNumber,
          status: { not: "Deleted" },
        },
        select: { id: true },
      });
      if (task) taskIds = [task.id];
    }
    if (taskIds.length === 0) return { linked: 0, updated: 0, taskIds: [] };

    const actor = await transaction.user.findUnique({
      where: { id: input.actorUserId },
      select: { id: true, displayName: true, photoURL: true, email: true },
    });
    let linked = 0;
    let updated = 0;

    for (const taskId of taskIds) {
      const identity = {
        taskId_repositoryOwner_repositoryName_number: {
          taskId,
          repositoryOwner: input.repositoryOwner,
          repositoryName: input.repositoryName,
          number: input.number,
        },
      };
      const inserted = await transaction.taskPullRequest.createMany({
        data: {
          id: randomUUID(),
          taskId,
          repositoryOwner: input.repositoryOwner,
          repositoryName: input.repositoryName,
          githubRepositoryId: input.repositoryId,
          githubPullRequestId: input.pullRequestId,
          number: input.number,
          url: input.url,
          title: input.title,
          lifecycle: input.lifecycle,
          checkState: "pending",
          headSha: input.headSha,
          sourceUpdatedAt: input.sourceUpdatedAt,
          updatedAt: new Date(),
        },
        skipDuplicates: true,
      });

      await transaction.$queryRaw`
        SELECT "id" FROM "TaskPullRequest"
        WHERE "taskId" = ${taskId}
          AND "repositoryOwner" = ${input.repositoryOwner}
          AND "repositoryName" = ${input.repositoryName}
          AND "number" = ${input.number}
        FOR UPDATE
      `;
      const current = await transaction.taskPullRequest.findUnique({
        where: identity,
      });
      if (!current) continue;

      const wasCreated = inserted.count === 1;
      if (
        !wasCreated &&
        current.sourceUpdatedAt &&
        current.sourceUpdatedAt >= input.sourceUpdatedAt
      ) {
        continue;
      }

      const previousDisplayState = derivePullRequestDisplayState(
        current.lifecycle as PullRequestLifecycle,
        current.checkState as PullRequestCheckState,
      );
      const lifecycle =
        current.lifecycle === "merged" &&
        input.lifecycle !== "merged" &&
        input.action !== "reopened"
          ? "merged"
          : input.lifecycle;
      const checkState =
        current.headSha !== input.headSha ? "pending" : current.checkState;
      const pullRequest = wasCreated
        ? current
        : await transaction.taskPullRequest.update({
            where: { id: current.id },
            data: {
              githubRepositoryId: input.repositoryId,
              githubPullRequestId: input.pullRequestId,
              url: input.url,
              title: input.title,
              lifecycle,
              checkState,
              headSha: input.headSha,
              sourceUpdatedAt: input.sourceUpdatedAt,
            },
          });
      const displayState = derivePullRequestDisplayState(
        pullRequest.lifecycle as PullRequestLifecycle,
        pullRequest.checkState as PullRequestCheckState,
      );

      if (wasCreated || displayState !== previousDisplayState) {
        let activityAction: "linked" | "state_changed" | "closed" = "closed";
        if (wasCreated) activityAction = "linked";
        else if (pullRequest.lifecycle === "open") {
          activityAction = "state_changed";
        }
        await writePullRequestActivity(transaction, {
          taskId,
          actor: wasCreated ? actor : null,
          action: activityAction,
          pullRequest: {
            url: pullRequest.url,
            title: pullRequest.title,
            number: pullRequest.number,
            repository: `${pullRequest.repositoryOwner}/${pullRequest.repositoryName}`,
            displayState,
          },
        });
      }
      if (wasCreated) linked += 1;
      else updated += 1;
    }

    return { linked, updated, taskIds };
  });
}

export async function syncCheckSuiteFromWebhook(
  input: CheckSuiteWebhookUpdate,
): Promise<{ updated: number; taskIds: number[] }> {
  return prisma.$transaction(async (transaction) => {
    const pullRequests = await transaction.taskPullRequest.findMany({
      where: {
        repositoryOwner: input.repositoryOwner,
        repositoryName: input.repositoryName,
        number: input.number,
        lifecycle: "open",
        headSha: input.headSha,
        task: { status: { not: "Deleted" } },
      },
    });
    const taskIds: number[] = [];

    for (const pullRequest of pullRequests) {
      await transaction.$queryRaw`
        SELECT "id" FROM "TaskPullRequest"
        WHERE "id" = ${pullRequest.id}
        FOR UPDATE
      `;
      const currentPullRequest = await transaction.taskPullRequest.findUnique({
        where: { id: pullRequest.id },
      });
      if (
        !currentPullRequest ||
        currentPullRequest.lifecycle !== "open" ||
        currentPullRequest.headSha !== input.headSha
      ) {
        continue;
      }
      const existingSuite =
        await transaction.taskPullRequestCheckSuite.findUnique({
          where: {
            pullRequestId_githubAppId: {
              pullRequestId: pullRequest.id,
              githubAppId: input.githubAppId,
            },
          },
        });
      if (isStaleCheckSuiteObservation(existingSuite, input)) {
        continue;
      }

      await transaction.taskPullRequestCheckSuite.upsert({
        where: {
          pullRequestId_githubAppId: {
            pullRequestId: pullRequest.id,
            githubAppId: input.githubAppId,
          },
        },
        create: {
          pullRequestId: pullRequest.id,
          githubAppId: input.githubAppId,
          appName: input.appName,
          headSha: input.headSha,
          status: input.status,
          conclusion: input.conclusion,
          sourceUpdatedAt: input.sourceUpdatedAt,
        },
        update: {
          appName: input.appName,
          headSha: input.headSha,
          status: input.status,
          conclusion: input.conclusion,
          sourceUpdatedAt: input.sourceUpdatedAt,
        },
      });
      const suites = await transaction.taskPullRequestCheckSuite.findMany({
        where: { pullRequestId: pullRequest.id, headSha: input.headSha },
        select: { status: true, conclusion: true },
      });
      const checkState = checkStateFromSuites(suites);
      if (checkState === currentPullRequest.checkState) continue;

      const updated = await transaction.taskPullRequest.update({
        where: { id: currentPullRequest.id },
        data: { checkState },
      });
      await writePullRequestActivity(transaction, {
        taskId: currentPullRequest.taskId,
        action: "state_changed",
        pullRequest: {
          url: updated.url,
          title: updated.title,
          number: updated.number,
          repository: `${updated.repositoryOwner}/${updated.repositoryName}`,
          displayState: derivePullRequestDisplayState(
            updated.lifecycle as PullRequestLifecycle,
            checkState,
          ),
        },
      });
      taskIds.push(currentPullRequest.taskId);
    }

    return { updated: taskIds.length, taskIds: [...new Set(taskIds)] };
  });
}
