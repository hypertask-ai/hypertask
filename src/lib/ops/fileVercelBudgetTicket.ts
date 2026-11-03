import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/lib/email/sendEmail";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { escapeHtml } from "@/utils/htmlEscape";
import {
  budgetAlertDescription,
  budgetAlertMarker,
  budgetAlertSubject,
  budgetAlertTitle,
  type VercelBudgetAlert,
} from "./vercelBudgetAlert";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const BOARD_LABEL_VALUE = "Infra";
const OPS_USER_ID = 332;
const OWNER_EMAIL = "valentin.yeo@gmail.com";
const EMAIL_CLAIM_TTL_SECONDS = 20 * 60 * 60;
const FULL_THRESHOLD_PERCENT = 100;

export interface FiledVercelBudgetAlert {
  taskId: number;
  created: boolean;
  emailed: boolean;
}

async function findBudgetTicket(marker: string) {
  return prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
    select: { id: true },
  });
}

async function createBudgetTicket(alert: VercelBudgetAlert) {
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
  if (!project?.uniqueIdentifier || !section) {
    throw new Error("Vercel budget board or section is unavailable");
  }
  const { task } = await createProvisionedTaskCore({
    title: budgetAlertTitle(alert),
    description: budgetAlertDescription(alert),
    userId: OPS_USER_ID,
    creationChannel: "api",
    projectId: BOARD_PROJECT_ID,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectIdentifier: project.uniqueIdentifier,
    priorityIndex: 1,
    labelIds: project.labels.map((label) => label.id),
    createDrafts: false,
  });
  const taskId = Number(task.id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("Vercel budget ticket was not created");
  return taskId;
}

async function addBudgetAlertComment(taskId: number, alert: VercelBudgetAlert) {
  await prisma.comment.create({
    data: {
      taskId,
      creatorId: OPS_USER_ID,
      text: `<p>Another Vercel ${escapeHtml(alert.budgetScope)} alert: ${alert.thresholdPercent}%.</p><p>Spent so far: $${alert.currentSpend.toFixed(2)} of $${alert.budgetAmount.toFixed(2)}.</p>`,
    },
  });
}

async function claimOwnerEmail(marker: string) {
  try {
    const redis = await getRedis();
    return (await redis.set(`vercel:budget-alert:email:${marker}`, "1", "EX", EMAIL_CLAIM_TTL_SECONDS, "NX")) === "OK";
  } catch (error) {
    console.error("[vercel-budget-alert] email claim failed", error);
    return false;
  }
}

async function emailOwner(alert: VercelBudgetAlert, taskId: number, marker: string) {
  if (alert.thresholdPercent < FULL_THRESHOLD_PERCENT) return false;
  if (!(await claimOwnerEmail(marker))) return false;
  try {
    await sendEmail({
      to: OWNER_EMAIL,
      from: "Hypertask <notifications@hypertask.ai>",
      subject: budgetAlertSubject(alert),
      text: [
        `Vercel sent a budget alert.`,
        `Limit: ${alert.budgetScope} reached ${alert.thresholdPercent}%.`,
        `Spent so far: $${alert.currentSpend.toFixed(2)} of $${alert.budgetAmount.toFixed(2)}.`,
        `Ticket: https://app.hypertask.ai/detail/project-${BOARD_PROJECT_ID}/${taskId}`,
      ].join("\n"),
    });
    return true;
  } catch (error) {
    console.error("[vercel-budget-alert] owner email failed", error);
    return false;
  }
}

export async function fileVercelBudgetTicket(alert: VercelBudgetAlert): Promise<FiledVercelBudgetAlert> {
  const marker = budgetAlertMarker(alert);
  const existing = await findBudgetTicket(marker);
  const taskId = existing ? existing.id : await createBudgetTicket(alert);
  if (existing) await addBudgetAlertComment(taskId, alert);
  const emailed = await emailOwner(alert, taskId, marker);
  return { taskId, created: !existing, emailed };
}
