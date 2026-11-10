import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import {
  repairEmptyViewColumns,
  type EmptyViewColumnRepair,
} from "@/lib/savedViews/repairEmptyViewColumns";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { escapeHtml } from "@/utils/htmlEscape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Backlog";
const BOARD_LABEL_VALUE = "Infra";
const OPS_USER_ID = 332;
const RUN_GATE_TTL_SECONDS = 20 * 60 * 60;

export const REPAIR_TICKET_TITLE = "Daily check repaired saved views with no column list";

const dayKey = (now: Date) => now.toISOString().slice(0, 10);

export function repairTicketMarker(now: Date) {
  return `saved-view-columns:${dayKey(now)}`;
}

export function repairTicketDescription(repair: EmptyViewColumnRepair, now: Date) {
  const boards = repair.boards
    .map(
      (board) =>
        `<li><p><strong>${escapeHtml(board.board)}</strong> (project ${board.projectId}): ${board.views
          .map((view) => escapeHtml(view))
          .join(", ")}</p></li>`,
    )
    .join("");
  return (
    `<p><strong>What's wrong or wanted:</strong> ${repair.viewsRepaired} saved ${
      repair.viewsRepaired === 1 ? "view had" : "views had"
    } no saved column list, so ${repair.viewsRepaired === 1 ? "it" : "they"} could hide columns. The daily check gave each one its board's columns.</p>` +
    `<p><strong>Who it affects:</strong> anyone opening the views named below.</p>` +
    `<p><strong>Recommended course and why:</strong> nothing to fix. This ticket records what the check repaired, so a person can look if one of these boards still looks wrong.</p>` +
    `<p><strong>What Valentin must decide:</strong> nothing.</p>` +
    `<p><strong>How to undo:</strong> hide or show columns in each named view, or remove the daily check.</p>` +
    `<hr>` +
    `<h2>Repaired on ${dayKey(now)}</h2>` +
    `<ul>${boards}</ul>` +
    `<p>Filters and sorting were not touched. ${repair.boardsWithoutColumns} ${
      repair.boardsWithoutColumns === 1 ? "board had" : "boards had"
    } no live columns to copy, so ${repair.boardsWithoutColumns === 1 ? "it was" : "they were"} left alone.</p>` +
    `<p>Marker: ${escapeHtml(repairTicketMarker(now))}</p>`
  );
}

async function fileRepairTicket(repair: EmptyViewColumnRepair, now: Date) {
  const marker = repairTicketMarker(now);
  const existing = await prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
    select: { id: true, uniqueIndex: true },
  });
  if (existing) return { filed: false, taskId: Number(existing.id), ticket: existing.uniqueIndex };

  const project = await prisma.project.findFirst({
    where: { id: BOARD_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: {
        where: { deleted: false, visibility: true, section_title: BOARD_SECTION_TITLE },
        orderBy: { ranking: "asc" },
        take: 1,
        select: { id: true, section_title: true },
      },
      labels: { where: { value: BOARD_LABEL_VALUE }, select: { id: true }, take: 1 },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section) {
    throw new Error("saved view repair board or section is unavailable");
  }

  const { task } = await createProvisionedTaskCore({
    title: REPAIR_TICKET_TITLE,
    description: repairTicketDescription(repair, now),
    userId: OPS_USER_ID,
    creationChannel: "api",
    projectId: BOARD_PROJECT_ID,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    labelIds: project.labels.map((label) => label.id),
    createDrafts: false,
  });
  return { filed: true, taskId: Number(task.id), ticket: task.uniqueIndex ?? null };
}

async function claimDailyRun(now: Date) {
  try {
    const redis = await getRedis();
    return (await redis.set(`saved-view-columns:run:${dayKey(now)}`, "1", "EX", RUN_GATE_TTL_SECONDS, "NX")) === "OK";
  } catch {
    return true;
  }
}

async function releaseDailyRun(now: Date) {
  try {
    const redis = await getRedis();
    await redis.del(`saved-view-columns:run:${dayKey(now)}`);
  } catch {
  }
}

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!(await claimDailyRun(now))) {
    return NextResponse.json({ skipped: "already ran today" });
  }

  try {
    const repair = await repairEmptyViewColumns();
    const ticket = repair.viewsRepaired > 0 ? await fileRepairTicket(repair, now) : null;
    console.info("[saved-view-columns]", {
      viewsFound: repair.viewsFound,
      viewsRepaired: repair.viewsRepaired,
      boards: repair.boards.length,
      boardsWithoutColumns: repair.boardsWithoutColumns,
      ticket: ticket?.ticket ?? null,
    });
    return NextResponse.json({ ...repair, ticket });
  } catch (error) {
    await releaseDailyRun(now);
    console.error("[saved-view-columns] run failed", error);
    return NextResponse.json({ error: "saved view column repair failed" }, { status: 500 });
  }
}
