import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import {
  FEATURE_FLAG_OWNER_USER_ID,
  FEATURE_FLAG_TICKET_PROJECT_ID,
  FLAG_REMOVAL_COUNTDOWN_FLAG,
} from "@/lib/flags";
import { FEATURE_FLAG_REMOVAL_DAYS } from "@/lib/flags/removal";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOVAL_PROJECT_ID = FEATURE_FLAG_TICKET_PROJECT_ID;
const REMOVAL_SECTION_TITLE = "Bugs";
const REMOVAL_LABEL_VALUE = "Bug";
// One sweep never files more than this, so a mistake in the due-date logic cannot flood the board.
const MAX_TICKETS_PER_RUN = 3;
// Only one sweep may run at a time: two overlapping runs could both see a flag with no ticket and
// both file one. Vercel does not overlap its own cron, but the route is reachable by anything
// holding CRON_SECRET, so serialise it the way the rest of the app serialises write fences.
const REMOVAL_SWEEP_LOCK_NAMESPACE = 6193;
const REMOVAL_SWEEP_LOCK_KEY = 1;

function removalTitle(key: string) {
  return `Remove feature flag ${key}`;
}

function removalDescription(key: string, releasedAt: Date) {
  const released = releasedAt.toISOString().slice(0, 10);
  return (
    `<p><strong>Delete the feature flag <code>${key}</code> and the code branch it guards.</strong></p>` +
    `<ul><li><p>It has been on <strong>Everyone</strong> since ${released}, which is more than ` +
    `${FEATURE_FLAG_REMOVAL_DAYS} days, so the behaviour behind it is permanent.</p></li>` +
    `<li><p>Remove the key from <code>FEATURE_FLAG_DEFINITIONS</code>, delete every <code>useFlag</code> ` +
    `and server check for it, keep the enabled branch, and add a migration deleting the stored row.</p></li>` +
    `<li><p>Filed automatically by the feature flag removal sweep. Press <strong>Keep</strong> on ` +
    `<a href="https://app.hypertask.ai/admin/flags">the flags page</a> to stop this for a flag.</p></li></ul>`
  );
}

/**
 * HTPR-6193: daily sweep that hands a flag over for deletion once it has spent
 * FEATURE_FLAG_REMOVAL_DAYS on Everyone without the owner pressing Keep.
 *
 * Dormant until the owner sets htpr-6193-flag-removal-countdown to Everyone. isFeatureEnabled is
 * deliberately not used: a cron has no user, and at the default mode it would answer true for the
 * owner id and arm the board writes before anyone opted in.
 */
export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sweepFlag = await prisma.featureFlag.findUnique({
    where: { key: FLAG_REMOVAL_COUNTDOWN_FLAG },
    select: { mode: true },
  });
  if (sweepFlag?.mode !== "EVERYONE") {
    return NextResponse.json({ skipped: "sweep flag is not released", filed: 0 });
  }

  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          CAST(${REMOVAL_SWEEP_LOCK_NAMESPACE} AS integer),
          CAST(${REMOVAL_SWEEP_LOCK_KEY} AS integer)
        ) AS acquired
      `;
      if (!lock?.acquired) return NextResponse.json({ skipped: "sweep already running", filed: 0 });
      return sweep();
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

async function sweep() {
  const cutoff = new Date(Date.now() - FEATURE_FLAG_REMOVAL_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.featureFlag.findMany({
    where: {
      mode: "EVERYONE",
      keep: false,
      removalTaskId: null,
      releasedAt: { not: null, lte: cutoff },
    },
    select: { key: true, releasedAt: true },
    orderBy: { releasedAt: "asc" },
    take: MAX_TICKETS_PER_RUN,
  });
  if (due.length === 0) return NextResponse.json({ filed: 0, failed: [] });

  const project = await prisma.project.findFirst({
    where: { id: REMOVAL_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: {
        where: { deleted: false, visibility: true, section_title: REMOVAL_SECTION_TITLE },
        // Ordered so a board with two columns of the same name always files into the same one.
        orderBy: { id: "asc" },
        take: 1,
        select: { id: true, section_title: true },
      },
    },
  });
  const section = project?.section[0];
  if (!project?.uniqueIdentifier || !section) {
    return NextResponse.json({ error: "removal destination is not configured" }, { status: 500 });
  }
  const label = await prisma.label.findFirst({
    where: { projectId: REMOVAL_PROJECT_ID, value: REMOVAL_LABEL_VALUE },
    select: { id: true },
  });

  const filed: string[] = [];
  const failed: string[] = [];
  for (const flag of due) {
    try {
      // Re-read immediately before writing: the owner may have pressed Keep or moved the flag
      // off Everyone since the query above.
      const current = await prisma.featureFlag.findUnique({
        where: { key: flag.key },
        select: { mode: true, keep: true, removalTaskId: true, releasedAt: true },
      });
      if (
        !current ||
        current.mode !== "EVERYONE" ||
        current.keep ||
        current.removalTaskId !== null ||
        !current.releasedAt ||
        current.releasedAt > cutoff
      ) {
        continue;
      }

      // ponytail: the title lookup, not a unique constraint, is what stops a second ticket after
      // a crash between creating the task and recording its id. A daily cron never overlaps
      // itself, so the remaining race is theoretical; add a unique automation key if it ever runs
      // concurrently.
      const title = removalTitle(flag.key);
      const existing = await prisma.task.findFirst({
        where: { projectId: REMOVAL_PROJECT_ID, title, status: "Normal" },
        select: { id: true },
      });
      const taskId =
        existing?.id ??
        (
          await createTaskCore({
            title,
            description: removalDescription(flag.key, current.releasedAt),
            userId: FEATURE_FLAG_OWNER_USER_ID,
            projectId: REMOVAL_PROJECT_ID,
            sectionId: section.id,
            sectionTitle: section.section_title,
            projectIdentifier: project.uniqueIdentifier,
            labelIds: label ? [label.id] : undefined,
          })
        ).task.id;
      await prisma.featureFlag.update({
        where: { key: flag.key },
        data: { removalTaskId: taskId },
      });
      filed.push(flag.key);
    } catch (error) {
      // One bad flag must not abort the batch; tomorrow's run retries it.
      failed.push(flag.key);
      console.error(`[feature-flags] removal ticket failed for ${flag.key}`, error);
    }
  }

  return NextResponse.json({ filed: filed.length, keys: filed, failed });
}
