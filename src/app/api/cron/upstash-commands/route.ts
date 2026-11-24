import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import {
  runUpstashCommandCheck,
  UPSTASH_ALARM_LOCK_KEY,
  UPSTASH_SAMPLE_KEY,
} from "@/lib/ops/upstashCommandAlarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const BOARD_LABEL_VALUE = "Infra";
const OPS_USER_ID = 332;

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const redis = await getRedis();
  const result = await runUpstashCommandCheck({
    now: Date.now(),
    info: await redis.info("stats"),
    readSample: () => redis.get(UPSTASH_SAMPLE_KEY),
    writeSample: (value) => redis.set(UPSTASH_SAMPLE_KEY, value).then(() => undefined),
    claim: async () => (await redis.set(UPSTASH_ALARM_LOCK_KEY, "1", "EX", 120, "NX")) === "OK",
    findTicket: async (marker) => {
      const existing = await prisma.task.findFirst({
        where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
        select: { id: true },
      });
      return existing ? existing.id : null;
    },
    createTicket: async (ticket) => {
      const project = await prisma.project.findFirst({
        where: { id: BOARD_PROJECT_ID, status: "Normal" },
        select: {
          uniqueIdentifier: true,
          section: {
            where: { deleted: false, visibility: true, section_title: BOARD_SECTION_TITLE },
            select: { id: true, section_title: true },
            take: 1,
          },
          labels: { where: { value: BOARD_LABEL_VALUE }, select: { id: true }, take: 1 },
        },
      });
      const section = project?.section[0];
      if (!project?.uniqueIdentifier || !section) throw new Error("Upstash alarm board is unavailable");
      const created = await createProvisionedTaskCore({
        title: ticket.title,
        description: ticket.description,
        userId: OPS_USER_ID,
        creationChannel: "api",
        projectId: BOARD_PROJECT_ID,
        sectionId: section.id,
        sectionTitle: section.section_title,
        projectIdentifier: project.uniqueIdentifier,
        priorityIndex: ticket.priorityIndex,
        labelIds: project.labels.map((label) => label.id),
        createDrafts: false,
      });
      return Number(created.task.id);
    },
  });
  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ commands: result.commands, filed: result.filed, taskId: result.taskId });
}
