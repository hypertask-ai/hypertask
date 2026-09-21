import { NextRequest, NextResponse } from "next/server";

import { checkMcpRateLimit, validateMcpAuth } from "@/lib/mcp/auth";
import prisma from "@/lib/prisma";
import {
  CORE_SMOKE_AGENT_NAME,
  CORE_SMOKE_ALT_SECTION,
  CORE_SMOKE_BASE_SECTION,
  CORE_SMOKE_BOARD_TITLE,
  CORE_SMOKE_RUN_ID_PATTERN,
  CORE_SMOKE_TASK_TITLE,
  runCoreActionsSmoke,
} from "@/lib/productionSmoke/coreActions";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import {
  decideCoreSmokeAccess,
  isProductionCoreSmokeRequest,
} from "@/lib/productionSmoke/access";
import { CORE_ACTIONS_SMOKE_FLAG, isFeatureEnabled } from "@/lib/flags";
import {
  CoreSmokeLockUnavailableError,
  withCoreSmokeLock,
} from "@/lib/productionSmoke/lock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PRODUCTION_ORIGIN = "https://app.hypertask.ai";

type ProbeBody = {
  projectId?: unknown;
  taskId?: unknown;
  baseSectionId?: unknown;
  altSectionId?: unknown;
  agentId?: unknown;
  runId?: unknown;
};

const positiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

export async function POST(request: NextRequest) {
  if (!isProductionCoreSmokeRequest(request.url)) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateMcpAuth(request);
  // This endpoint turns an authenticated health identity into a short-lived
  // browser session for one fixed fixture. Agent tokens must not inherit their
  // owner's wider browser permissions through it.
  const access = decideCoreSmokeAccess(ctx, true);
  if (!access.ok) {
    return NextResponse.json(
      { success: false, error: access.error },
      { status: access.status },
    );
  }
  const principal = access.principal;
  if (!(await isFeatureEnabled(CORE_ACTIONS_SMOKE_FLAG, principal.user.id))) {
    return NextResponse.json({
      success: false,
      result: {
        ok: false,
        kind: "unrunnable",
        action: "check feature flag",
        detail: "the core-actions smoke flag is disabled for this user",
        steps: [],
        cleanup: [],
      },
    });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const body = parsed as ProbeBody;

  if (
    !positiveInteger(body.projectId) ||
    !positiveInteger(body.taskId) ||
    !positiveInteger(body.baseSectionId) ||
    !positiveInteger(body.altSectionId) ||
    typeof body.agentId !== "string" ||
    !body.agentId ||
    typeof body.runId !== "string" ||
    !body.runId ||
    !CORE_SMOKE_RUN_ID_PATTERN.test(body.runId)
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid fixture configuration" },
      { status: 400 },
    );
  }
  const { projectId, taskId, baseSectionId, altSectionId, agentId, runId } =
    body;

  const [user, project, task] = await Promise.all([
    prisma.user.findUnique({
      where: { id: principal.user.id },
      select: { id: true, email: true, displayName: true, photoURL: true },
    }),
    prisma.project.findFirst({
      where: {
        id: projectId,
        ownerId: principal.user.id,
        title: CORE_SMOKE_BOARD_TITLE,
        status: "Normal",
      },
      select: {
        id: true,
        section: {
          where: { id: { in: [baseSectionId, altSectionId] }, deleted: false },
          select: { id: true, section_title: true },
        },
        members: {
          where: { agentId },
          select: {
            agent: { select: { id: true, displayName: true, revokedAt: true } },
          },
        },
      },
    }),
    prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
        title: CORE_SMOKE_TASK_TITLE,
        status: "Normal",
        userId: principal.user.id,
      },
      select: { id: true },
    }),
  ]);

  const sectionById = new Map(
    project?.section.map((section) => [section.id, section.section_title]),
  );
  const agent = project?.members[0]?.agent;
  const matchesFixture = Boolean(
    user &&
    project &&
    task &&
    sectionById.get(baseSectionId) === CORE_SMOKE_BASE_SECTION &&
    sectionById.get(altSectionId) === CORE_SMOKE_ALT_SECTION &&
    agent &&
    !agent.revokedAt &&
    agent.id === agentId &&
    agent.displayName === CORE_SMOKE_AGENT_NAME,
  );
  const fixtureAccess = decideCoreSmokeAccess(principal, matchesFixture);
  if (!fixtureAccess.ok) {
    return NextResponse.json(
      { success: false, error: fixtureAccess.error },
      { status: fixtureAccess.status },
    );
  }
  if (!user || !agent)
    throw new Error("Validated core-smoke fixture was unavailable");

  const cookieHeader = [
    `${SESSION_COOKIE}=${encodeURIComponent(signSession({ id: user.id, email: user.email }, 120))}`,
    `nookies_user=${encodeURIComponent(JSON.stringify(user))}`,
  ].join("; ");

  let result;
  try {
    result = await withCoreSmokeLock(`${projectId}:${taskId}`, (signal) =>
      runCoreActionsSmoke({
        baseUrl: PRODUCTION_ORIGIN,
        cookieHeader,
        signal,
        fixture: {
          projectId,
          taskId,
          baseSectionId,
          altSectionId,
          userId: user.id,
          userDisplayName: user.displayName?.trim() || "Core smoke user",
          agentId: agent.id,
          agentDisplayName: agent.displayName,
        },
        runId,
      }),
    );
  } catch (error) {
    const lockUnavailable = error instanceof CoreSmokeLockUnavailableError;
    if (!lockUnavailable) {
      console.error(
        "[core-actions-smoke] Run failed before returning a result:",
        error instanceof Error ? error.message : "unknown error",
      );
    }
    result = {
      ok: false,
      kind: "unrunnable" as const,
      action: lockUnavailable ? "acquire fixture lock" : "configure smoke run",
      detail: lockUnavailable ? error.message : "the smoke run could not start",
      steps: [],
      cleanup: [],
    };
  }

  return NextResponse.json({ success: result.ok, result });
}
