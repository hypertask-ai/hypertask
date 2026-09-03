import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  agentTokenCredentialFields,
  agentTokenMatchesStored,
  createMcpToken,
} from "@/lib/mcp/auth";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { UNPINNABLE_MODEL_OPTION_IDS } from "@/lib/nativeAgent/modelPin";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { workingOnByAgent } from "@/lib/agents/working";
import { ownedAgentSlugs, resolveOwnedAgent } from "@/lib/agents/ownedSlugs";
import { agentPoolScope } from "@/lib/agents/poolScope";
import {
  classifyRuntimeHealth,
  clearAgentRuntimeSnapshot,
  filterRuntimeSnapshotToBoards,
  MAX_RUNTIME_QUEUE_ITEMS,
  type AgentRuntimeQueueItem,
  readAgentRuntimeSnapshot,
  selectAgentOperationsQueue,
} from "@/lib/agents/runtimeState";
import {
  deleteOwnedAgent,
  type AgentManagementDatabase,
} from "@/lib/mcp/agents/ownedAgents";
import { buildAgentBoardAccess } from "@/lib/agents/boardAccess";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  isAgentVisibility,
  setOwnedAgentVisibility,
} from "@/lib/agents/visibility";

/**
 * The URL carries a readable slug now (/agents/board-maintainer), so every
 * handler resolves whatever it was given back to an id first. Ids still work,
 * which is what keeps old links and API callers running.
 */
async function resolveAgent(userId: number, ref: string) {
  return resolveOwnedAgent(userId, ref);
}

async function getCurrentUser(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  return session ? { id: session.userId } : null;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const user = await getCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const resolved = await resolveAgent(user.id, params.agentId);
  const agent = resolved
    ? await prisma.agent.findFirst({
    where: { id: resolved.id, userId: user.id },
    select: {
      id: true,
      displayName: true,
      visibility: true,
      photoURL: true,
      createdAt: true,
      revokedAt: true,
      archivedAt: true,
      userId: true,
      permissions: true,
      runtimeType: true,
      prompt: true,
      modelOptionId: true,
      heartbeatAt: true,
      mcpTokenJti: true,
      runtimeGeneration: true,
      // The detail page states which boards the agent works on, the same list
      // its register card shows.
      members: {
        where: {
          status: "Accepted",
          project: { status: "Normal", ...getProjectWhere(user.id) },
        },
        select: {
          project: {
            select: {
              id: true,
              name: true,
              title: true,
              team: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
      })
    : null;

  if (!agent) {
    return NextResponse.json(
      { success: false, error: "Agent does not exist" },
      { status: 404 },
    );
  }

  // The register card decides Running/Quiet from the newest of heartbeat and
  // posted comment, so this page has to read the same pair or the two surfaces
  // disagree about the same agent.
  const [lastPosted, workingByAgent, accessibleBoards, allMemberships] =
    await Promise.all([
      prisma.comment.aggregate({
        where: {
          agentId: agent.id,
          task: { project: getProjectWhere(user.id) },
        },
        _max: { createdAt: true },
      }),
      workingOnByAgent([agent.id], user.id),
      prisma.project.findMany({
        where: { status: "Normal", ...getProjectWhere(user.id) },
        select: {
          id: true,
          name: true,
          title: true,
          team: { select: { id: true, title: true } },
        },
      }),
      prisma.member.findMany({
        where: { agentId: agent.id },
        select: { project: { select: { teamId: true } } },
      }),
    ]);
  const working = workingByAgent.get(agent.id);

  const {
    permissions,
    members,
    mcpTokenJti,
    runtimeGeneration,
    ...agentFields
  } = agent;
  const storedRuntimeSnapshot = await readAgentRuntimeSnapshot(
    agent.id,
    runtimeGeneration,
  );
  const boardIds = members.map(({ project }) => project.id);
  const visibleBoardIds = new Set(boardIds);
  // An agent can remain a board member after its owner loses access. Runtime
  // state is therefore filtered through the same owner-visible membership
  // list as board names and activity before any ticket metadata is returned.
  const runtimeSnapshot = filterRuntimeSnapshotToBoards(
    storedRuntimeSnapshot,
    visibleBoardIds,
  );
  const sourceSections = runtimeSnapshot?.sourceSections ?? [];
  const { sourceScopeWhere, eligiblePoolWhere, assignedWhere } = agentPoolScope({
    agentId: agent.id,
    boardIds,
    sourceSections,
    scopeLabel: runtimeSnapshot?.scopeLabel ?? null,
  });
  const processedReferences = runtimeSnapshot?.processedTickets ?? [];
  const [
    sourceTotal,
    assignedCount,
    unownedCount,
    specialistOwnedCount,
    processedUnownedCount,
    eligiblePool,
  ] =
    boardIds.length > 0
      ? await Promise.all([
          sourceSections.length > 0
            ? prisma.task.count({ where: sourceScopeWhere })
            : Promise.resolve(null),
          prisma.task.count({ where: assignedWhere }),
          sourceSections.length > 0
            ? prisma.task.count({
                where: {
                  AND: [
                    sourceScopeWhere,
                    { assignees: { none: { agentId: { not: null } } } },
                  ],
                },
              })
            : Promise.resolve(0),
          sourceSections.length > 0
            ? prisma.task.count({
                where: {
                  AND: [
                    sourceScopeWhere,
                    {
                      assignees: {
                        some: {
                          agentId: { not: null, notIn: [agent.id] },
                        },
                      },
                    },
                  ],
                },
              })
            : Promise.resolve(0),
          sourceSections.length > 0 && processedReferences.length > 0
            ? prisma.task.count({
                where: {
                  AND: [
                    sourceScopeWhere,
                    {
                      OR: processedReferences.map(({ boardId, ticket }) => ({
                        projectId: boardId,
                        ticketNumber: ticket,
                      })),
                    },
                    { assignees: { none: { agentId: { not: null } } } },
                  ],
                },
              })
            : Promise.resolve(0),
          sourceSections.length > 0
            ? prisma.task.count({ where: eligiblePoolWhere })
            : Promise.resolve(null),
        ])
      : [null, 0, 0, 0, 0, null];
  // Per-column breakdown: one "48 tickets" number hides that the agent can act
  // on only a few of them, and in which column they sit.
  const eligibleBySection = new Map<string, number>();
  if (boardIds.length > 0 && sourceSections.length > 0) {
    const grouped = await prisma.task.groupBy({
      by: ["projectId", "section"],
      where: eligiblePoolWhere,
      _count: { _all: true },
    });
    for (const row of grouped) {
      eligibleBySection.set(`${row.projectId}:${row.section}`, row._count._all);
    }
  }
  const sourceBreakdown = sourceSections.map(({ boardId, section }) => ({
    boardId,
    section,
    eligible: eligibleBySection.get(`${boardId}:${section}`) ?? 0,
  }));
  const runtimeHealth = agent.revokedAt
    ? "offline"
    : classifyRuntimeHealth(runtimeSnapshot);
  const runtimeIsCurrent = Boolean(
    !agent.revokedAt && runtimeSnapshot && runtimeHealth !== "offline",
  );
  const inferredTasks =
    !runtimeIsCurrent && boardIds.length > 0
      ? await prisma.task.findMany({
          where: assignedWhere,
          orderBy: [
            { dueDate: { sort: "asc", nulls: "last" } },
            { priority: { priority_index: "asc" } },
            { uniqueIndex: "asc" },
          ],
          take: MAX_RUNTIME_QUEUE_ITEMS,
          select: {
            ticketNumber: true,
            uniqueIndex: true,
            title: true,
            section: true,
            projectId: true,
            dueDate: true,
            project: { select: { name: true, title: true } },
            priority: { select: { Priority_Value: true, priority_index: true } },
          },
        })
      : [];
  const inferredQueue: AgentRuntimeQueueItem[] = runtimeIsCurrent
    ? []
    : inferredTasks
        .map((task) => ({
          ticket: task.ticketNumber ?? `Task ${task.uniqueIndex}`,
          title: task.title,
          url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
          boardId: task.projectId,
          boardName: task.project.title ?? task.project.name,
          section: task.section,
          state: working?.ticket === task.ticketNumber ? "running" : "pending",
          reason: "assignment",
          priority: task.priority?.Priority_Value ?? null,
          dueAt: task.dueDate?.toISOString() ?? null,
          startedAt:
            working?.ticket === task.ticketNumber ? working.since : null,
        }));
  const operations = selectAgentOperationsQueue({
    snapshot: runtimeSnapshot,
    inferredQueue,
    health: runtimeHealth,
    enabled: !agent.revokedAt,
  });

  return NextResponse.json({
    success: true,
    agent: {
      ...agentFields,
      // The page can canonicalise its own URL from this, so a link built on an
      // id lands on the readable one.
      slug: resolved?.slug ?? agent.id,
      lastPostedAt: lastPosted._max.createdAt?.toISOString() ?? null,
      // Same shape the register card reads, from the same lease query.
      working: working ?? null,
      hasMcpToken: Boolean(mcpTokenJti),
      // Same board shape as /api/agents/owned, team included: the two routes
      // feed the same TAgent type, so a field one sends and the other drops is
      // a lie the compiler cannot catch.
      boards: members.map(({ project }) => ({
        id: project.id,
        name: project.title ?? project.name,
        teamId: project.team?.id ?? null,
        teamName: project.team?.title ?? null,
      })),
      boardAccess: buildAgentBoardAccess(
        accessibleBoards.map((project) => ({
          id: project.id,
          name: project.title ?? project.name,
          teamId: project.team?.id ?? null,
          teamName: project.team?.title ?? null,
        })),
        boardIds,
        allMemberships.map(({ project }) => project.teamId),
      ),
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt ? agent.revokedAt.toISOString() : null,
      archivedAt: agent.archivedAt ? agent.archivedAt.toISOString() : null,
      heartbeatAt: agent.heartbeatAt ? agent.heartbeatAt.toISOString() : null,
      operations: {
        source: operations.source,
        health: runtimeHealth,
        snapshot: runtimeSnapshot,
        queue: operations.queue,
        sourceBreakdown,
        counts: {
          sourceTotal,
          eligiblePool,
          workerQueue:
            operations.source === "runtime"
              ? operations.queue.length
              : inferredQueue.length,
          assigned: assignedCount,
          unowned: unownedCount,
          specialistOwned: specialistOwnedCount,
          processedUnowned: processedUnownedCount,
          directMentions:
            operations.source === "runtime"
              ? operations.queue.filter(
                  (item) => item.reason === "direct_mention",
                ).length
              : 0,
        },
      },
    },
  });
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const user = await getCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const resolved = await resolveAgent(user.id, params.agentId);
  const existing = resolved
    ? await prisma.agent.findFirst({
        where: { id: resolved.id, userId: user.id },
      })
    : null;

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Agent does not exist" },
      { status: 404 },
    );
  }

  let body: {
    displayName?: unknown;
    photoURL?: unknown;
    postsToImportant?: unknown;
    prompt?: unknown;
    modelOptionId?: unknown;
    revoke?: unknown;
    revoked?: unknown;
    archived?: unknown;
    visibility?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (body.visibility !== undefined) {
    const suppliedFields = Object.entries(body).filter(
      ([, value]) => value !== undefined,
    );
    if (suppliedFields.length !== 1 || !isAgentVisibility(body.visibility)) {
      return NextResponse.json(
        { success: false, error: "Invalid visibility" },
        { status: 400 },
      );
    }
    const result = await setOwnedAgentVisibility(
      existing.id,
      user.id,
      body.visibility,
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({
      success: true,
      agent: { id: existing.id, visibility: result.visibility },
    });
  }

  // `revoked` states the wanted result, `revoke` only says "flip it". Two tabs
  // flipping at once cancel each other out, so the dashboard sends the target
  // and only the old manage modal still toggles.
  if (body.revoke === true || typeof body.revoked === "boolean") {
    const revokedAt =
      typeof body.revoked === "boolean"
        ? body.revoked
          ? (existing.revokedAt ?? new Date())
          : null
        : existing.revokedAt
          ? null
          : new Date();
    const isReEnabling = Boolean(existing.revokedAt) && revokedAt === null;
    let reenabledToken: string | null = null;
    // A disabled agent cannot keep authenticating with its destroyed token.
    // Clear again before re-enabling so an in-flight old-token heartbeat that
    // raced the disable cannot resurrect its prior queue.
    const clearRuntimeBestEffort = async () => {
      try {
        await clearAgentRuntimeSnapshot(existing.id);
      } catch (error) {
        console.warn("[Agent runtime] Snapshot invalidation failed:", error);
      }
    };
    if (isReEnabling) await clearRuntimeBestEffort();
    if (isReEnabling && existing.runtimeType === "EXTERNAL") {
      const owner = await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true },
      });
      if (!owner) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 },
        );
      }
      // The prior credential was destroyed when the agent was disabled.
      // Re-enable with a fresh generation and reveal it in this response only.
      reenabledToken = createMcpToken(
        user.id,
        owner.email,
        undefined,
        existing.id,
      );
    }
    if (isReEnabling) {
      const transition = await prisma.agent.updateMany({
        where: {
          id: existing.id,
          userId: user.id,
          revokedAt: { not: null },
        },
        data: {
          revokedAt: null,
          ...agentTokenCredentialFields(reenabledToken),
          mcpTokenExpiresAt: null,
          runtimeGeneration: { increment: 1 },
        },
      });
      if (transition.count === 0) {
        const current = await prisma.agent.findFirst({
          where: { id: existing.id, userId: user.id },
          select: {
            id: true,
            displayName: true,
            photoURL: true,
            revokedAt: true,
            mcpTokenJti: true,
          },
        });
        if (!current) {
          return NextResponse.json(
            { success: false, error: "Agent does not exist" },
            { status: 404 },
          );
        }
        const { mcpTokenJti, ...agentFields } = current;
        return NextResponse.json({
          success: true,
          agent: { ...agentFields, hasToken: Boolean(mcpTokenJti) },
        });
      }
    } else if (revokedAt) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          revokedAt,
          ...agentTokenCredentialFields(null),
          mcpTokenExpiresAt: null,
          runtimeGeneration: { increment: 1 },
        },
      });
      await clearRuntimeBestEffort();
    }

    const agent = await prisma.agent.findUniqueOrThrow({
      where: { id: existing.id },
      select: {
        id: true,
        displayName: true,
        photoURL: true,
        revokedAt: true,
        mcpTokenHash: true,
        mcpTokenJti: true,
      },
    });
    const { mcpTokenHash, mcpTokenJti, ...agentFields } = agent;
    // The plaintext is not readable back out of the row, so the digest is what
    // says whether the token this call minted is the one now stored.
    const tokenToReveal =
      isReEnabling &&
      reenabledToken &&
      agent.revokedAt === null &&
      agentTokenMatchesStored(reenabledToken, { mcpTokenHash })
        ? reenabledToken
        : null;
    return NextResponse.json({
      success: true,
      agent: { ...agentFields, hasToken: Boolean(mcpTokenJti) },
      ...(tokenToReveal ? { token: tokenToReveal } : {}),
    });
  }

  const data: {
    displayName?: string;
    photoURL?: string | null;
    permissions?: Prisma.InputJsonValue;
    prompt?: string | null;
    modelOptionId?: string | null;
    archivedAt?: Date | null;
  } = {};
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Invalid archived" },
        { status: 400 },
      );
    }
    // Archiving files an agent away; it does not switch it off. Keeping the two
    // independent is what lets a running agent be hidden from the register
    // without cutting its access mid-task.
    data.archivedAt = body.archived ? (existing.archivedAt ?? new Date()) : null;
  }
  if (typeof body.displayName === "string") {
    const d = body.displayName.trim();
    if (!d || d.length > 200) {
      return NextResponse.json(
        { success: false, error: "Invalid displayName" },
        { status: 400 },
      );
    }
    data.displayName = d;
  }
  if (body.photoURL === null) {
    data.photoURL = null;
  } else if (
    typeof body.photoURL === "string" &&
    body.photoURL.trim().length > 0
  ) {
    data.photoURL = body.photoURL.trim();
  }
  if (body.prompt !== undefined) {
    if (existing.runtimeType !== "NATIVE") {
      return NextResponse.json(
        { success: false, error: "Only native agents accept instructions" },
        { status: 400 },
      );
    }
    if (body.prompt === null) {
      data.prompt = null;
    } else if (typeof body.prompt === "string") {
      const p = body.prompt.trim();
      if (p.length > 8000) {
        return NextResponse.json(
          {
            success: false,
            error: "Instructions are too long (max 8000 chars)",
          },
          { status: 400 },
        );
      }
      data.prompt = p.length > 0 ? p : null;
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid prompt" },
        { status: 400 },
      );
    }
  }
  if (body.modelOptionId !== undefined) {
    // Only a native agent's turns run through the chat route, so a pin on an
    // external one would persist, display, and do nothing. Same rule as the
    // instructions above.
    if (existing.runtimeType !== "NATIVE") {
      return NextResponse.json(
        { success: false, error: "Only native agents run on a pinned model" },
        { status: 400 },
      );
    }
    if (body.modelOptionId === null) {
      // Back to the team default.
      data.modelOptionId = null;
    } else if (
      typeof body.modelOptionId === "string" &&
      // Validated against the real option list, not stored as free text: an
      // unknown id would silently fall through to the default at request time
      // and the pin would look set while doing nothing.
      getAiModelOptionById(body.modelOptionId) &&
      // "custom" is not a model, it is "whatever endpoint you configured", and
      // an agent has nowhere to configure one. Pinned to it, every turn fails
      // while the agent reads as pinned and healthy. The dashboard hides it;
      // rejecting it here is what actually stops it.
      !UNPINNABLE_MODEL_OPTION_IDS.has(body.modelOptionId)
    ) {
      data.modelOptionId = body.modelOptionId;
    } else {
      return NextResponse.json(
        { success: false, error: "Unknown model" },
        { status: 400 },
      );
    }
  }
  if (body.postsToImportant !== undefined) {
    if (typeof body.postsToImportant !== "boolean") {
      return NextResponse.json(
        { success: false, error: "Invalid postsToImportant" },
        { status: 400 },
      );
    }
    const permissions =
      existing.permissions &&
      typeof existing.permissions === "object" &&
      !Array.isArray(existing.permissions)
        ? existing.permissions
        : {};
    data.permissions = {
      ...permissions,
      postsToImportant: body.postsToImportant,
    };
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { success: false, error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const agent = await prisma.agent.update({
    where: { id: existing.id },
    data,
    select: {
      id: true,
      displayName: true,
      visibility: true,
      photoURL: true,
      createdAt: true,
      revokedAt: true,
      archivedAt: true,
      permissions: true,
      runtimeType: true,
      prompt: true,
      modelOptionId: true,
      heartbeatAt: true,
    },
  });

  const { permissions, ...agentFields } = agent;
  // Recomputed after the write, not taken from the pre-update resolve: a rename
  // moves the slug, and the page has to send the reader to the new URL.
  const slugs = await ownedAgentSlugs(user.id);
  return NextResponse.json({
    success: true,
    agent: {
      ...agentFields,
      slug: slugs.get(agent.id) ?? agent.id,
      archivedAt: agent.archivedAt ? agent.archivedAt.toISOString() : null,
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
    },
  });
}

/**
 * Deleting an agent for good, from its own page.
 *
 * Same transaction the MCP route uses, so the two surfaces cannot clean up
 * different things: board memberships and task assignments go with it, and its
 * comments stay (they are history, not the agent).
 */
export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  const params = await props.params;
  const user = await getCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const resolved = await resolveAgent(user.id, params.agentId);
  const deleted = resolved
    ? await deleteOwnedAgent(
        prisma as unknown as AgentManagementDatabase,
        user.id,
        resolved.id,
        clearAgentRuntimeSnapshot,
      )
    : null;
  if (!deleted) {
    return NextResponse.json(
      { success: false, error: "Agent does not exist" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    agent: { id: deleted.id },
    cleanup: {
      board_memberships: deleted.deleted_board_memberships,
      task_assignments: deleted.deleted_task_assignments,
      comment_tombstones: deleted.comment_tombstones,
    },
  });
}
