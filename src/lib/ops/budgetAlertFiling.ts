import { budgetAlertMarker, budgetAlertMarkerHtml, type VercelBudgetAlert } from "./vercelBudgetAlert";

const FULL_THRESHOLD_PERCENT = 100;
const DUPLICATE_RECHECKS = 3;
const DUPLICATE_RECHECK_DELAY_MS = 250;

export type BudgetAlertEmail = "not-needed" | "sent" | "already-sent" | "failed";
export type BudgetAlertEmailClaim = "claimed" | "already-sent" | "pending" | "unavailable";

export interface FiledVercelBudgetAlert {
  taskId: number;
  created: boolean;
  email: BudgetAlertEmail;
}

export interface BudgetAlertStore {
  findTicket(marker: string): Promise<number | null>;
  createTicket(alert: VercelBudgetAlert): Promise<number>;
  addComment(taskId: number, alert: VercelBudgetAlert): Promise<void>;
  reserve(marker: string): Promise<boolean>;
  release(marker: string): Promise<void>;
  reserveSpend(key: string): Promise<boolean>;
  releaseSpend(key: string): Promise<void>;
  claimEmail(marker: string): Promise<BudgetAlertEmailClaim>;
  markEmailSent(marker: string): Promise<void>;
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

function spendKey(alert: VercelBudgetAlert) {
  return `${budgetAlertMarker(alert)}:spend:${alert.currentSpend}`;
}

async function waitForExistingTicket(store: BudgetAlertStore, marker: string) {
  for (let attempt = 0; attempt < DUPLICATE_RECHECKS; attempt++) {
    await sleep(DUPLICATE_RECHECK_DELAY_MS);
    const taskId = await store.findTicket(marker);
    if (taskId) return taskId;
  }
  return null;
}

async function recordSpendOnce(
  taskId: number,
  alert: VercelBudgetAlert,
  store: BudgetAlertStore,
) {
  const key = spendKey(alert);
  if (!(await store.reserveSpend(key))) return;
  try {
    await store.addComment(taskId, alert);
  } catch (error) {
    await store.releaseSpend(key);
    throw error;
  }
}

async function deliverOwnerEmail(
  taskId: number,
  alert: VercelBudgetAlert,
  marker: string,
  store: BudgetAlertStore,
): Promise<BudgetAlertEmail> {
  if (alert.thresholdPercent < FULL_THRESHOLD_PERCENT) return "not-needed";
  const claim = await store.claimEmail(marker);
  if (claim === "already-sent") return "already-sent";
  if (claim !== "claimed") return "failed";
  try {
    await store.email(taskId, alert);
    await store.markEmailSent(marker);
    return "sent";
  } catch (error) {
    console.error("[vercel-budget-alert] owner email failed", error);
    await store.releaseEmail(marker);
    return "failed";
  }
}

export async function fileBudgetAlert(
  alert: VercelBudgetAlert,
  store: BudgetAlertStore,
): Promise<FiledVercelBudgetAlert> {
  const marker = budgetAlertMarkerHtml(alert);
  let taskId = await store.findTicket(marker);
  let created = false;

  if (taskId) {
    await recordSpendOnce(taskId, alert, store);
  } else if (!(await store.reserve(marker))) {
    const raced = await waitForExistingTicket(store, marker);
    if (!raced) throw new BudgetAlertRaceError();
    taskId = raced;
    await recordSpendOnce(taskId, alert, store);
  } else {
    const key = spendKey(alert);
    await store.reserveSpend(key);
    try {
      taskId = await store.createTicket(alert);
    } catch (error) {
      await store.releaseSpend(key);
      await store.release(marker);
      throw error;
    }
    created = true;
  }

  const email = await deliverOwnerEmail(taskId, alert, marker, store);
  return { taskId, created, email };
}
