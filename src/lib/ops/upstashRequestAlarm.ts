import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { withRedisAudience } from "@/lib/redis/audience";
import {
  readUpstashDailyMetrics,
  UPSTASH_DAILY_REQUEST_ALARM,
} from "@/lib/redis/metrics";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const MARKER = "htpr-8978-upstash-request-alarm";
const MARKER_HTML = `<p data-ht-marker="${MARKER}">`;

export async function checkUpstashDailyRequests() {
  return withRedisAudience("job", async () => {
    const redis = await getRedis();
    const metrics = await readUpstashDailyMetrics({
      incrby: (key, amount) => redis.incrby(key, amount),
      hincrby: (key, field, amount) => redis.hincrby(key, field, amount),
      expire: (key, seconds) => redis.expire(key, seconds),
      get: (key) => redis.get(key),
      hgetall: (key) => redis.hgetall(key),
    });
    const day = new Date().toISOString().slice(0, 10);
    if (metrics.total < UPSTASH_DAILY_REQUEST_ALARM) {
      return { day, filed: false, metrics };
    }
    const marker = `${MARKER}:${day}`;
    const existing = await prisma.task.findFirst({
      where: {
        projectId: BOARD_PROJECT_ID,
        description_: { is: { content: { contains: marker } } },
      },
      select: { id: true },
    });
    if (existing) return { day, filed: false, existingTaskId: existing.id, metrics };
    const project = await prisma.project.findFirst({
      where: { id: BOARD_PROJECT_ID, status: "Normal" },
      select: {
        uniqueIdentifier: true,
        section: {
          where: { deleted: false, visibility: true, section_title: BOARD_SECTION_TITLE },
          select: { id: true, section_title: true },
          take: 1,
        },
        labels: { where: { value: "Infra" }, select: { id: true }, take: 1 },
      },
    });
    const section = project?.section[0];
    if (!project?.uniqueIdentifier || !section) {
      throw new Error("Upstash alarm could not resolve Bugs section on board 15");
    }
    const description = [
      MARKER_HTML,
      `Upstash request volume crossed ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString()} on ${day}.`,
      `</p><p>Total commands today: ${metrics.total}. Human: ${metrics.human}. Agent: ${metrics.agent}. Job: ${metrics.job}.</p>`,
      `<p data-ht-marker="${marker}"></p>`,
    ].join("");
    const created = await createProvisionedTaskCore({
      title: `Upstash requests exceeded ${UPSTASH_DAILY_REQUEST_ALARM.toLocaleString()} on ${day}`,
      description,
      userId: 332,
      creationChannel: "api",
      projectId: BOARD_PROJECT_ID,
      sectionId: section.id,
      sectionTitle: section.section_title,
      projectIdentifier: project.uniqueIdentifier,
      priorityIndex: 1,
      labelIds: project.labels.map((label) => label.id),
      createDrafts: false,
    });
  const taskId = Number(created.task.id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Upstash request alarm ticket was not created");
    return { day, filed: true, taskId, metrics };
  });
}
