import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/lib/email/sendEmail";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { escapeHtml } from "@/utils/htmlEscape";
import {
  budgetAlertDescription,
  budgetAlertMarker,
  budgetAlertMarkerHtml,
  budgetAlertSubject,
  budgetAlertTitle,
  type VercelBudgetAlert,
} from "./vercelBudgetAlert";

const BOARD_PROJECT_ID = 15;
const BOARD_SECTION_TITLE = "Bugs";
const BOARD_LABEL_VALUE = "Infra";
const OPS_USER_ID = 332;
const OWNER_EMAIL = "valentin.yeo@gmail.com";
const KEEP_ALIVE_TTL_SECONDS = 20 * 60 * 60;
const IN_FLIGHT_TTL_SECONDS = 120;
const RESERVATION_TTL_SECONDS = 60;
const FULL_THRESHOLD_PERCENT = 100;
const DUPLICATE_RECHECKS = 3;
const DUPLICATE_RECHECK_DELAY_MS = 250;

export type BudgetAlertEmail = "not-needed" | "sent" | "already-sent" | "failed";

export interface FiledVercelBudgetAlert {
  taskId: number;
  created: boolean;
  email: BudgetAlertEmail;
}

export class BudgetAlertRaceError extends Error {
  constructor() {
    super("Another delivery is filing this Vercel budget alert");
  }
}

export class BudgetAlertPendingError extends Error {
  constructor() {
    super("A previous delivery of this Vercel budget alert is still in flight");
  }
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function spendKey(alert: VercelBudgetAlert) {
  return `${budgetAlertMarker(alert)}:spend:${alert.currentSpend}`;
}

function emailKey(marker: string) {
  return `vercel:budget-alert:email:${marker}`;
}

async function findTicket(marker: string) {
  const existing = await prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
    select: { id: true },
  });
  return existing ? existing.id : null;
}

async function createTicket(alert: VercelBudgetAlert) {
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

async function addComment(taskId: number, alert: VercelBudgetAlert) {
  await prisma.comment.create({
    data: {
      taskId,
      creatorId: OPS_USER_ID,
      text: `<p>Another Vercel ${escapeHtml(alert.budgetScope)} alert: ${alert.thresholdPercent}%.</p><p>Spent so far: $${alert.currentSpend.toFixed(2)} of $${alert.budgetAmount.toFixed(2)}.</p>`,
    },
  });
}

async function reserveMarker(marker: string) {
  const redis = await getRedis();
  return (await redis.set(`vercel:budget-alert:reserve:${marker}`, "1", "EX", RESERVATION_TTL_SECONDS, "NX")) === "OK";
}

async function releaseKey(key: string) {
  try {
    const redis = await getRedis();
    await redis.del(key);
  } catch (error) {
    console.error("[vercel-budget-alert] key release failed", error);
  }
}

async function reserveSpend(key: string) {
  try {
    const redis = await getRedis();
    const claimed = await redis.set(key, "pending", "EX", IN_FLIGHT_TTL_SECONDS, "NX");
    if (claimed === "OK") return "claimed" as const;
    return (await redis.get(key)) === "written" ? ("written" as const) : ("retry" as const);
  } catch (error) {
    console.error("[vercel-budget-alert] spend claim failed", error);
    return "retry" as const;
  }
}

async function markSpendWritten(key: string) {
  const redis = await getRedis();
  await redis.set(key, "written", "EX", KEEP_ALIVE_TTL_SECONDS);
}

async function waitForTicket(marker: string) {
  for (let attempt = 0; attempt < DUPLICATE_RECHECKS; attempt++) {
    await sleep(DUPLICATE_RECHECK_DELAY_MS);
    const taskId = await findTicket(marker);
    if (taskId) return taskId;
  }
  return null;
}

async function recordSpendOnce(taskId: number, alert: VercelBudgetAlert) {
  const key = spendKey(alert);
  const claim = await reserveSpend(key);
  if (claim === "written") return;
  if (claim === "retry") throw new BudgetAlertPendingError();
  try {
    await addComment(taskId, alert);
    await markSpendWritten(key);
  } catch (error) {
    await releaseKey(key);
    throw error;
  }
}

async function deliverOwnerEmail(
  taskId: number,
  alert: VercelBudgetAlert,
  marker: string,
): Promise<BudgetAlertEmail> {
  if (alert.thresholdPercent < FULL_THRESHOLD_PERCENT) return "not-needed";
  let claim: string;
  try {
    const redis = await getRedis();
    const claimed = await redis.set(emailKey(marker), "pending", "EX", IN_FLIGHT_TTL_SECONDS, "NX");
    claim = claimed === "OK" ? "claimed" : ((await redis.get(emailKey(marker))) === "sent" ? "already-sent" : "retry");
  } catch (error) {
    console.error("[vercel-budget-alert] email claim failed", error);
    return "failed";
  }
  if (claim === "already-sent") return "already-sent";
  if (claim !== "claimed") return "failed";
  try {
    await sendEmail({
      to: OWNER_EMAIL,
      from: "Hypertask <notifications@hypertask.ai>",
      subject: budgetAlertSubject(alert),
      text: [
        "Vercel sent a budget alert.",
        `Limit: ${alert.budgetScope} reached ${alert.thresholdPercent}%.`,
        `Spent so far: $${alert.currentSpend.toFixed(2)} of $${alert.budgetAmount.toFixed(2)}.`,
        `Ticket: https://app.hypertask.ai/detail/project-${BOARD_PROJECT_ID}/${taskId}`,
      ].join("\n"),
    });
  } catch (error) {
    console.error("[vercel-budget-alert] owner email failed", error);
    await releaseKey(emailKey(marker));
    return "failed";
  }
  try {
    const redis = await getRedis();
    await redis.set(emailKey(marker), "sent", "EX", KEEP_ALIVE_TTL_SECONDS);
  } catch (error) {
    console.error("[vercel-budget-alert] email completion write failed", error);
  }
  return "sent";
}

export async function fileVercelBudgetTicket(alert: VercelBudgetAlert): Promise<FiledVercelBudgetAlert> {
  const marker = budgetAlertMarkerHtml(alert);
  let taskId = await findTicket(marker);
  let created = false;

  if (taskId) {
    await recordSpendOnce(taskId, alert);
  } else if (!(await reserveMarker(marker))) {
    const raced = await waitForTicket(marker);
    if (!raced) throw new BudgetAlertRaceError();
    taskId = raced;
    await recordSpendOnce(taskId, alert);
  } else {
    const key = spendKey(alert);
    try {
      await markSpendWritten(key);
      taskId = await createTicket(alert);
    } catch (error) {
      await releaseKey(key);
      await releaseKey(`vercel:budget-alert:reserve:${marker}`);
      throw error;
    }
    created = true;
  }

  const email = await deliverOwnerEmail(taskId, alert, marker);
  return { taskId, created, email };
}
