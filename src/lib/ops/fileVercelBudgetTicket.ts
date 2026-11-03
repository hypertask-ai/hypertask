import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/lib/email/sendEmail";
import { createProvisionedTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { escapeHtml } from "@/utils/htmlEscape";
import {
  budgetAlertDescription,
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
const CLAIM_TTL_SECONDS = 20 * 60 * 60;
const RESERVATION_TTL_SECONDS = 60;
const FULL_THRESHOLD_PERCENT = 100;
const DUPLICATE_RECHECKS = 3;
const DUPLICATE_RECHECK_DELAY_MS = 250;

export interface FiledVercelBudgetAlert {
  taskId: number;
  created: boolean;
  emailed: boolean;
}

export interface BudgetAlertStore {
  findTicket(marker: string): Promise<number | null>;
  createTicket(alert: VercelBudgetAlert): Promise<number>;
  addComment(taskId: number, alert: VercelBudgetAlert): Promise<void>;
  reserve(marker: string): Promise<boolean>;
  claimEmail(marker: string): Promise<boolean>;
  releaseEmail(marker: string): Promise<void>;
  email(taskId: number, alert: VercelBudgetAlert): Promise<void>;
}

export class BudgetAlertRaceError extends Error {
  constructor() {
    super("Another delivery is filing this Vercel budget alert");
  }
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function waitForExistingTicket(store: BudgetAlertStore, marker: string) {
  for (let attempt = 0; attempt < DUPLICATE_RECHECKS; attempt++) {
    await sleep(DUPLICATE_RECHECK_DELAY_MS);
    const taskId = await store.findTicket(marker);
    if (taskId) return taskId;
  }
  return null;
}

export async function fileBudgetAlert(
  alert: VercelBudgetAlert,
  store: BudgetAlertStore,
): Promise<FiledVercelBudgetAlert> {
  const marker = budgetAlertMarkerHtml(alert);
  let taskId = await store.findTicket(marker);
  let created = false;

  if (!taskId) {
    if (!(await store.reserve(marker))) {
      const raced = await waitForExistingTicket(store, marker);
      if (!raced) throw new BudgetAlertRaceError();
      taskId = raced;
    } else {
      taskId = await store.createTicket(alert);
      created = true;
    }
  } else {
    await store.addComment(taskId, alert);
  }

  const emailed = await deliverOwnerEmail(taskId, alert, marker, store);
  return { taskId, created, emailed };
}

async function deliverOwnerEmail(
  taskId: number,
  alert: VercelBudgetAlert,
  marker: string,
  store: BudgetAlertStore,
) {
  if (alert.thresholdPercent < FULL_THRESHOLD_PERCENT) return false;
  if (!(await store.claimEmail(marker))) return false;
  try {
    await store.email(taskId, alert);
    return true;
  } catch (error) {
    console.error("[vercel-budget-alert] owner email failed", error);
    await store.releaseEmail(marker);
    return false;
  }
}

async function findBudgetTicket(marker: string) {
  const existing = await prisma.task.findFirst({
    where: { projectId: BOARD_PROJECT_ID, description_: { is: { content: { contains: marker } } } },
    select: { id: true },
  });
  return existing ? existing.id : null;
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

export const prismaBudgetAlertStore: BudgetAlertStore = {
  findTicket: findBudgetTicket,
  createTicket: createBudgetTicket,
  addComment: addBudgetAlertComment,
  async reserve(marker) {
    const redis = await getRedis();
    return (await redis.set(`vercel:budget-alert:reserve:${marker}`, "1", "EX", RESERVATION_TTL_SECONDS, "NX")) === "OK";
  },
  async claimEmail(marker) {
    try {
      const redis = await getRedis();
      return (await redis.set(`vercel:budget-alert:email:${marker}`, "1", "EX", CLAIM_TTL_SECONDS, "NX")) === "OK";
    } catch (error) {
      console.error("[vercel-budget-alert] email claim failed", error);
      return false;
    }
  },
  async releaseEmail(marker) {
    try {
      const redis = await getRedis();
      await redis.del(`vercel:budget-alert:email:${marker}`);
    } catch (error) {
      console.error("[vercel-budget-alert] email release failed", error);
    }
  },
  async email(taskId, alert) {
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
  },
};

export function fileVercelBudgetTicket(alert: VercelBudgetAlert) {
  return fileBudgetAlert(alert, prismaBudgetAlertStore);
}
