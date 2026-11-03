import { budgetAlertMarkerHtml, type VercelBudgetAlert } from "./vercelBudgetAlert";

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

export async function fileBudgetAlert(
  alert: VercelBudgetAlert,
  store: BudgetAlertStore,
): Promise<FiledVercelBudgetAlert> {
  const marker = budgetAlertMarkerHtml(alert);
  let taskId = await store.findTicket(marker);
  let created = false;

  if (taskId) {
    await store.addComment(taskId, alert);
  } else if (!(await store.reserve(marker))) {
    const raced = await waitForExistingTicket(store, marker);
    if (!raced) throw new BudgetAlertRaceError();
    taskId = raced;
    await store.addComment(taskId, alert);
  } else {
    taskId = await store.createTicket(alert);
    created = true;
  }

  const emailed = await deliverOwnerEmail(taskId, alert, marker, store);
  return { taskId, created, emailed };
}
