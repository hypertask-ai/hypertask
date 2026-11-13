import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import {
  FEATURE_FLAG_ADMIN_URL,
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_OWNER_USER_ID,
  FEATURE_FLAG_SWEEP_AGENT_ID,
  FEATURE_FLAG_TICKET_PROJECT_ID,
  RETIRED_FEATURE_FLAG_KEYS,
} from "@/lib/flags";
import { FLAG_REMOVAL_TICKETS_PER_RUN, PENDING_REMOVAL_TASK_ID, removalProfile, removalWindowForFlag, selectDueFlags } from "@/lib/flags/removal";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { withAdoptedAgentMutationLease } from "@/lib/mcp/tasks/agentMutationLeaseAdoption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REMOVAL_PROJECT_ID = FEATURE_FLAG_TICKET_PROJECT_ID;
const REMOVAL_SECTION_ID = 4389;
const REMOVAL_LABEL_VALUE = "Bug";
const REMOVAL_SWEEP_LOCK_NAMESPACE = 1_179_207_763;
const REMOVAL_SWEEP_LOCK_KEY = 1;

const FLAG_KEY_ID = /^[a-z]+[0-9]*-[0-9]+-?/;

function plainSwitchName(key: string) {
  return key.replace(FLAG_KEY_ID, "").replace(/-/g, " ").trim();
}

function removalTitle(key: string) {
  const name = plainSwitchName(key);
  return name ? `Remove the released switch for ${name}` : "Remove a released switch";
}

function removalDescription(key: string, releasedAt: Date) {
  const released = releasedAt.toISOString().slice(0, 10);
  const days = removalWindowForFlag({ key });
  return (
    `<h2>Problem</h2>` +
    `<p>The released change is still hidden behind a safety switch.</p>` +
    `<p>It is live for Everyone since ${released}.</p>` +
    `<p>That is more than ${days} days.</p>` +
    `<h2>Fix</h2>` +
    `<p>Keep the behaviour the switch turned on.</p>` +
    `<p>Remove the switch, the unused alternative and its saved setting.</p>` +
    `<p>Switch: <a href="${FEATURE_FLAG_ADMIN_URL}/${key}">open the switch on the flags page</a></p>` +
    `<h2>Done when</h2>` +
    `<p>The behaviour still works with the switch gone.</p>` +
    `<p>No code reads the old switch or its saved setting.</p>` +
    `<h2>Risk</h2>` +
    `<p>Low. Undo: revert the change.</p>` +
    `<h2>Decision</h2>` +
    `<p>None. To keep the switch, choose Keep on the flags page.</p>` +
    `<p>Flags: <a href="${FEATURE_FLAG_ADMIN_URL}">the flags page</a></p>`
  );
}

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let result: NextResponse | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(
            CAST(${REMOVAL_SWEEP_LOCK_NAMESPACE} AS integer),
            CAST(${REMOVAL_SWEEP_LOCK_KEY} AS integer)
          ) AS acquired
        `;
        if (!lock?.acquired) {
          result = NextResponse.json({ skipped: "sweep already running", filed: 0 });
          return;
        }
        result = await sweep();
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!result) throw error;
    console.error("[feature-flags] sweep lock transaction failed after the sweep ran", error);
  }
  return result ?? NextResponse.json({ skipped: "sweep did not run", filed: 0 });
}

async function sweep() {
  await prisma.featureFlag.updateMany({
    where: { key: { in: FEATURE_FLAG_KEYS }, removalTaskId: PENDING_REMOVAL_TASK_ID },
    data: { removalTaskId: null },
  });
  const stored = await prisma.featureFlag.findMany({
    where: {
      key: { in: FEATURE_FLAG_KEYS, notIn: [...RETIRED_FEATURE_FLAG_KEYS] },
      mode: "EVERYONE",
      keep: false,
      removalTaskId: null,
      releasedAt: { not: null },
    },
    select: { key: true, releasedAt: true, mode: true, keep: true, removalTaskId: true },
    orderBy: { releasedAt: "asc" },
  });
  const eligible = selectDueFlags(stored.map((flag) => ({
    ...flag,
    ...removalProfile(flag.key),
  })));
  const due = eligible.slice(0, FLAG_REMOVAL_TICKETS_PER_RUN);
  const deferred = eligible.length - due.length;
  if (due.length === 0) return NextResponse.json({ filed: 0, failed: [], deferred });

  const project = await prisma.project.findFirst({
    where: { id: REMOVAL_PROJECT_ID, status: "Normal" },
    select: {
      uniqueIdentifier: true,
      section: {
        where: { deleted: false, visibility: true, id: REMOVAL_SECTION_ID },
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
    if (!flag.releasedAt) continue;
    const cutoff = new Date(Date.now() - removalWindowForFlag({ key: flag.key }) * 24 * 60 * 60 * 1000);
    const claimed = await prisma.featureFlag.updateMany({
      where: {
        key: { equals: flag.key, in: FEATURE_FLAG_KEYS },
        mode: "EVERYONE",
        keep: false,
        removalTaskId: null,
        releasedAt: { not: null, lte: cutoff },
      },
      data: { removalTaskId: PENDING_REMOVAL_TASK_ID },
    });
    if (claimed.count !== 1) continue;

    try {
      const title = removalTitle(flag.key);
      const description = removalDescription(flag.key, flag.releasedAt);
      const projectIdentifier = project.uniqueIdentifier;
      const existing = await prisma.task.findFirst({
        where: {
          projectId: REMOVAL_PROJECT_ID,
          title,
          status: "Normal",
          description_: { is: { content: { contains: `/${flag.key}"` } } },
        },
        select: { id: true },
      });
      const taskId =
        existing?.id ??
        (
          await withAdoptedAgentMutationLease(
            prisma,
            { agentId: FEATURE_FLAG_SWEEP_AGENT_ID, userId: FEATURE_FLAG_OWNER_USER_ID },
            () => createProvisionedTaskCore({
              creationChannel: "api",
              title,
              description,
              userId: FEATURE_FLAG_OWNER_USER_ID,
              agentId: FEATURE_FLAG_SWEEP_AGENT_ID,
              projectId: REMOVAL_PROJECT_ID,
              sectionId: section.id,
              sectionTitle: section.section_title,
              projectIdentifier,
              labelIds: label ? [label.id] : undefined,
            }),
          )
        ).task.id;
      const recorded = await prisma.featureFlag.updateMany({
        where: {
          key: flag.key,
          removalTaskId: PENDING_REMOVAL_TASK_ID,
          mode: "EVERYONE",
          keep: false,
          releasedAt: flag.releasedAt,
        },
        data: { removalTaskId: taskId },
      });
      if (recorded.count === 0) {
        console.warn(`[feature-flags] ${flag.key} was re-released while its removal ticket was filed`);
        await prisma.task
          .update({ where: { id: taskId }, data: { status: "Archive" } })
          .catch((error) =>
            console.error(`[feature-flags] failed to archive stale removal ticket for ${flag.key}`, error),
          );
        continue;
      }
      filed.push(flag.key);
    } catch (error) {
      await prisma.featureFlag
        .updateMany({
          where: { key: flag.key, removalTaskId: PENDING_REMOVAL_TASK_ID },
          data: { removalTaskId: null },
        })
        .catch(() => {});
      failed.push(flag.key);
      console.error(`[feature-flags] removal ticket failed for ${flag.key}`, error);
    }
  }

  return NextResponse.json({ filed: filed.length, keys: filed, failed, deferred });
}
