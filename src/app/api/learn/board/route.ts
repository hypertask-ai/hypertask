import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { provisionLearnBoard } from "@/lib/demo/provisionGuest";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import {
  ensureLearnTutorialInbox,
  type LearnTutorialInboxTarget,
  validateLearnTutorialInboxTargets,
} from "@/utils/controllers/tutorial/ensureLearnTutorialInbox";
import {
  KEYBOARD_SHORTCUT_TUTORIAL_ENABLED,
} from "@/lib/tutorial/keyboardShortcutTutorial";

export const runtime = "nodejs";
export const maxDuration = 30;

const BOARD_TITLE = "Learn Hypertask";
const TUTORIAL_COLUMN_TITLE = "Ready to ship";

const tutorialBoardUrl = (
  projectId: number,
  tutorialInboxTargets: LearnTutorialInboxTarget[],
  returnBoardId: number | null,
) =>
  `/project?id=${projectId}&tutorial=1&tutorialInbox=${tutorialInboxTargets
    .map(({ notificationId, taskId }) => `${notificationId}:${taskId}`)
    .join(",")}${returnBoardId ? `&tutorialReturn=${returnBoardId}` : ""}`;

const nextTutorialColumnTitle = (titles: string[]) => {
  const existing = new Set(titles.map((title) => title.trim().toLowerCase()));
  let candidate: string;
  do {
    const runSuffix = randomUUID()
      .replaceAll("-", "")
      .slice(0, 6)
      .toUpperCase();
    candidate = `${TUTORIAL_COLUMN_TITLE} ${runSuffix}`;
  } while (existing.has(candidate.toLowerCase()));
  return candidate;
};

export async function POST(request: NextRequest) {
  if (!KEYBOARD_SHORTCUT_TUTORIAL_ENABLED) {
    return NextResponse.json(
      { error: "The keyboard shortcuts tutorial is temporarily unavailable" },
      { status: 410 },
    );
  }

  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to start the tutorial" },
      { status: 401 },
    );
  }

  const parsedBody: unknown = await request.json().catch(() => ({}));
  if (
    typeof parsedBody !== "object" ||
    parsedBody === null ||
    Array.isArray(parsedBody)
  ) {
    return NextResponse.json(
      { error: "Invalid tutorial bootstrap request" },
      { status: 422 },
    );
  }
  const body = parsedBody as {
    returnBoardId?: unknown;
    tutorialInboxArchivedNotificationIds?: unknown;
    tutorialInboxTargets?: unknown;
  };
  const requestedReturnBoardId =
    Number.isSafeInteger(body.returnBoardId) && Number(body.returnBoardId) > 0
      ? Number(body.returnBoardId)
      : null;
  if (body.returnBoardId !== undefined && requestedReturnBoardId === null) {
    return NextResponse.json(
      { error: "Invalid tutorial return board" },
      { status: 422 },
    );
  }
  const rawTargets = body.tutorialInboxTargets;
  const requestedTargets = Array.isArray(rawTargets)
    ? rawTargets.filter(
        (target): target is LearnTutorialInboxTarget =>
          typeof target === "object" &&
          target !== null &&
          Number.isSafeInteger(
            (target as LearnTutorialInboxTarget).notificationId,
          ) &&
          (target as LearnTutorialInboxTarget).notificationId > 0 &&
          Number.isSafeInteger((target as LearnTutorialInboxTarget).taskId) &&
          (target as LearnTutorialInboxTarget).taskId > 0,
      )
    : null;
  if (rawTargets !== undefined) {
    if (
      !Array.isArray(rawTargets) ||
      requestedTargets === null ||
      requestedTargets.length !== rawTargets.length
    ) {
      return NextResponse.json(
        { error: "Invalid tutorial inbox context" },
        { status: 422 },
      );
    }
  }
  const rawArchivedNotificationIds = body.tutorialInboxArchivedNotificationIds;
  const requestedArchivedNotificationIds = Array.isArray(
    rawArchivedNotificationIds,
  )
    ? rawArchivedNotificationIds.filter(
        (notificationId): notificationId is number =>
          Number.isSafeInteger(notificationId) && notificationId > 0,
      )
    : null;
  if (
    rawArchivedNotificationIds !== undefined &&
    (!Array.isArray(rawArchivedNotificationIds) ||
      requestedArchivedNotificationIds === null ||
      requestedArchivedNotificationIds.length !==
        rawArchivedNotificationIds.length ||
      new Set(requestedArchivedNotificationIds).size !==
        requestedArchivedNotificationIds.length ||
      requestedTargets === null ||
      requestedArchivedNotificationIds.some(
        (notificationId) =>
          !requestedTargets.some(
            (target) => target.notificationId === notificationId,
          ),
      ))
  ) {
    return NextResponse.json(
      { error: "Invalid tutorial inbox archive context" },
      { status: 422 },
    );
  }

  const existingBoard = await prisma.project.findFirst({
    where: {
      ownerId: session.id,
      status: "Normal",
      title: BOARD_TITLE,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  try {
    let projectId = existingBoard?.id;
    if (!projectId) {
      const membership = await prisma.member_Team.findFirst({
        where: { userId: session.id, status: "Accepted" },
        orderBy: { acceptedAt: "asc" },
        select: { googleAccountId: true, teamId: true },
      });
      if (!membership) {
        return NextResponse.json(
          { error: "Could not find a workspace for your tutorial board" },
          { status: 422 },
        );
      }

      const board = await provisionLearnBoard({
        userId: session.id,
        googleAccountId: membership.googleAccountId,
        teamId: membership.teamId,
      });
      projectId = board.projectId;
    }
    const returnBoard =
      requestedReturnBoardId && requestedReturnBoardId !== projectId
        ? await prisma.project.findFirst({
            where: {
              id: requestedReturnBoardId,
              status: "Normal",
              ...getProjectWhere(session.id),
            },
            select: { id: true },
          })
        : null;
    const existingColumnTitles = await prisma.section.findMany({
      where: { deleted: false, projectId },
      orderBy: { ranking: "asc" },
      select: { section_title: true },
    });
    const tutorialColumnTitle = nextTutorialColumnTitle(
      existingColumnTitles.map(({ section_title }) => section_title),
    );
    const tutorialInboxTargets = requestedTargets
      ? await validateLearnTutorialInboxTargets({
          archivedNotificationIds: requestedArchivedNotificationIds ?? [],
          projectId,
          targets: requestedTargets,
          userId: session.id,
        })
      : await ensureLearnTutorialInbox({
          projectId,
          userId: session.id,
        });
    if (!tutorialInboxTargets) {
      return NextResponse.json(
        { error: "Tutorial inbox context is no longer valid" },
        { status: 422 },
      );
    }
    return NextResponse.json({
      boardUrl: tutorialBoardUrl(
        projectId,
        tutorialInboxTargets,
        returnBoard?.id ?? null,
      ),
      projectId,
      returnBoardId: returnBoard?.id ?? null,
      tutorialColumnTitle,
      tutorialInboxTargets,
    });
  } catch (error) {
    console.error("learn board provisioning failed", error);
    return NextResponse.json(
      { error: "Could not prepare your tutorial board" },
      { status: 500 },
    );
  }
}
