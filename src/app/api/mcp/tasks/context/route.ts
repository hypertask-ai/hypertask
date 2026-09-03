import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { checkMcpRateLimit, validateMcpAuth } from '@/lib/mcp/auth';
import prisma from '@/lib/prisma';
import { extractPrLinks } from '@/lib/mcp/tasks/extractPrLinks';
import {
  derivePullRequestDisplayState,
  parseGithubPullRequestUrl,
  type PullRequestCheckState,
  type PullRequestLifecycle,
} from '@/lib/pullRequests/githubPullRequests';
import {
  mapTaskToMcpGetResponse,
  taskMcpGetInclude,
} from '@/lib/mcp/tasks/mappers';
import { findTaskByIdentifier } from '@/lib/mcp/tasks/resolveTask';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';

const FULL_COMMENT_LIMIT = 20;
const SUMMARY_COMMENT_LIMIT = 3;
// Upper bound on comments scanned for PR links, so a huge thread stays cheap.
const PR_LINK_SCAN_LIMIT = 200;

const relatedTaskSelect = {
  id: true,
  ticketNumber: true,
  title: true,
  uniqueIndex: true,
} satisfies Prisma.TaskSelect;

function validationError(message: string) {
  return NextResponse.json(
    { success: false, error: message },
    { status: 400 }
  );
}

function parseRequiredPositiveInteger(
  searchParams: URLSearchParams,
  name: string
): { ok: true; value: number } | { ok: false; response: NextResponse } {
  const raw = searchParams.get(name);
  if (raw === null) {
    return { ok: false, response: validationError(`${name} is required`) };
  }

  if (!/^\d+$/.test(raw.trim())) {
    return {
      ok: false,
      response: validationError(`${name} must be a positive integer`),
    };
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return {
      ok: false,
      response: validationError(`${name} must be a positive integer`),
    };
  }

  return { ok: true, value };
}

/**
 * GET /api/mcp/tasks/context
 *
 * Returns a read-only context pack for one accessible task.
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;

    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized. Invalid or missing authentication token.',
        },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const taskIdResult = parseRequiredPositiveInteger(searchParams, 'task_id');
    if (!taskIdResult.ok) return taskIdResult.response;

    const projectIdResult = parseRequiredPositiveInteger(
      searchParams,
      'project_id'
    );
    if (!projectIdResult.ok) return projectIdResult.response;

    const summaryParam = searchParams.get('summary');
    if (
      summaryParam !== null &&
      summaryParam !== 'true' &&
      summaryParam !== 'false'
    ) {
      return validationError("summary must be either 'true' or 'false'");
    }

    const taskId = taskIdResult.value;
    const projectId = projectIdResult.value;
    const summary = summaryParam === 'true';

    const resolvedTask = await findTaskByIdentifier(
      ctx.user,
      { task_id: taskId },
      ctx.agentId
    );
    if (!resolvedTask || resolvedTask.projectId !== projectId) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      );
    }

    const commentWhere = {
      taskId: resolvedTask.id,
      activity: { equals: Prisma.DbNull },
    } satisfies Prisma.CommentWhereInput;
    const relatedTaskAccess = {
      status: { not: 'Deleted' },
      project: getProjectWhere(ctx.user.id, ctx.agentId),
    } satisfies Prisma.TaskWhereInput;
    const commentLimit = summary
      ? SUMMARY_COMMENT_LIMIT
      : FULL_COMMENT_LIMIT;

    const [task, commentCount, recentComments, prComments, relations] =
      await Promise.all([
        prisma.task.findFirst({
          where: {
            id: resolvedTask.id,
            projectId,
            status: { not: 'Deleted' },
          },
          include: {
            ...taskMcpGetInclude,
            pullRequests: {
              orderBy: { createdAt: 'asc' },
              select: {
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
              },
            },
            savedContent: {
              where: { userId: ctx.agentId ? -1 : ctx.user.id, commentId: null, type: 'Private' },
              select: { id: true, type: true },
            },
          },
        }),
        prisma.comment.count({ where: commentWhere }),
        prisma.comment.findMany({
          where: commentWhere,
          select: {
            id: true,
            text: true,
            createdAt: true,
            agentDisplayName: true,
            agent: {
              select: { displayName: true },
            },
            creator: {
              select: {
                email: true,
                displayName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: commentLimit,
        }),
        prisma.comment.findMany({
          where: commentWhere,
          select: {
            text: true,
            commentText: true,
          },
          orderBy: { createdAt: 'asc' },
          // Cap the PR-link scan so a long comment thread can't turn this
          // pre-session endpoint into an unbounded full-history fetch.
          take: PR_LINK_SCAN_LIMIT,
        }),
        prisma.taskRelations.findMany({
          where: {
            OR: [
              {
                sourceTaskId: resolvedTask.id,
                targetTask: relatedTaskAccess,
              },
              {
                targetTaskId: resolvedTask.id,
                sourceTask: relatedTaskAccess,
              },
            ],
          },
          select: {
            sourceTaskId: true,
            targetTaskId: true,
            relationType: true,
            sourceTask: { select: relatedTaskSelect },
            targetTask: { select: relatedTaskSelect },
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task not found or access denied' },
        { status: 404 }
      );
    }

    const mappedTask = mapTaskToMcpGetResponse(task);
    const comments = recentComments.reverse().map((comment) => ({
      id: comment.id,
      author:
        comment.agent?.displayName ||
        comment.agentDisplayName ||
        comment.creator?.displayName ||
        comment.creator?.email ||
        'Unknown',
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    }));
    const relatedTasks = relations.map((relation) => {
      const outgoing = relation.sourceTaskId === resolvedTask.id;
      const relatedTask = outgoing
        ? relation.targetTask
        : relation.sourceTask;

      return {
        id: relatedTask.id,
        ticketNumber: relatedTask.ticketNumber || undefined,
        title: relatedTask.title,
        uniqueIndex: relatedTask.uniqueIndex,
        relationType: relation.relationType,
        direction: outgoing ? 'outgoing' : 'incoming',
      };
    });
    const pullRequests = task.pullRequests.map((pullRequest) => {
      const lifecycle = pullRequest.lifecycle as PullRequestLifecycle;
      const checkState = pullRequest.checkState as PullRequestCheckState;
      return {
        ...pullRequest,
        displayState: derivePullRequestDisplayState(lifecycle, checkState),
      };
    });
    const legacyPullRequestUrls = extractPrLinks(
      mappedTask.description,
      ...prComments.flatMap((comment) => [comment.text, comment.commentText])
    )
      .map((url) => parseGithubPullRequestUrl(url)?.url)
      .filter((url): url is string => Boolean(url));
    const linkedPRs = [
      ...new Set([
        ...pullRequests.map((pullRequest) => pullRequest.url),
        ...legacyPullRequestUrls,
      ]),
    ];

    return NextResponse.json({
      success: true,
      task: {
        id: mappedTask.id,
        ticketNumber: mappedTask.ticketNumber,
        title: mappedTask.title,
        description: mappedTask.description,
        section: mappedTask.section,
        labels: mappedTask.labels,
        assignees: mappedTask.assignees,
        priority: mappedTask.priority,
        dueDate: mappedTask.dueDate,
        savedContent: mappedTask.savedContent,
      },
      parent: mappedTask.parent_task ?? null,
      subtasks: mappedTask.sub_tasks,
      relatedTasks,
      comments,
      pullRequests,
      linkedPRs,
      linkedPRsTruncated: commentCount > PR_LINK_SCAN_LIMIT,
      commentCount,
      truncated: commentCount > commentLimit,
    });
  } catch (error) {
    console.error('[MCP Task Context] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
