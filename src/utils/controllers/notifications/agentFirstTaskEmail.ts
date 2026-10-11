import { waitUntil } from "@vercel/functions";
import type { Task } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7028_FIRST_TASK_EMAIL_FLAG, HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { columnRoleFor } from "@/lib/mcp/boards/columnRole";
import { sendEmail } from "@/lib/email/sendEmail";
import { unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { renderAgentFirstTaskEmail } from "@/lib/onboarding/emails/agentFirstTask";
import { renderAgentFirstTaskEmail as renderLegacyAgentFirstTaskEmail } from "./emailTemplates";
import { trackActivation } from "@/lib/telemetry/activationAnalytics";

type CompletionTask = Pick<
  Task,
  "id" | "projectId" | "uniqueIndex" | "title" | "sectionId" | "section" | "status"
>;
const marker = "htpr-7028:agent-first-task-email:claimed";

export function scheduleAgentFirstTaskEmail(
  before: CompletionTask,
  after: CompletionTask,
  userId: number,
  agentId?: string | null,
): void {
  scheduleAgentFirstTaskEmailBatch([{ before, after }], userId, agentId);
}

export function scheduleAgentFirstTaskEmailBatch(
  tasks: { before: CompletionTask; after: CompletionTask }[],
  userId: number,
  agentId?: string | null,
): void {
  if (!agentId) return;
  const candidates = tasks.filter(({ before, after }) =>
    after.status === "Normal" &&
    (before.sectionId !== after.sectionId || before.section !== after.section)
  );
  if (!candidates.length) return;
  const work = sendAgentFirstTaskEmail(candidates, userId, agentId).catch(() => {
    console.warn("[agent-first-task-email] Email work failed", { userId });
  });
  try {
    waitUntil(work);
  } catch {
    // Outside Vercel the promise still runs, with rejection already handled.
  }
}

async function sendAgentFirstTaskEmail(
  candidates: { before: CompletionTask; after: CompletionTask }[],
  userId: number,
  agentId: string,
): Promise<void> {
  if (await prisma.logs.findFirst({ where: { LoggedById: userId, log: marker }, select: { id: true } })) return;

  const sectionIds = [...new Set(candidates.flatMap(({ before, after }) =>
    [before.sectionId, after.sectionId].filter((id): id is number => id !== null)
  ))];
  const sections = await prisma.section.findMany({
    where: { id: { in: sectionIds } },
    select: { id: true, section_title: true, isDone: true },
  });
  const isDone = (task: CompletionTask) => {
    const section = sections.find((section) => section.id === task.sectionId);
    return columnRoleFor(section ?? { section_title: task.section }) === "done";
  };
  const candidate = candidates.find(({ before, after }) => !isDone(before) && isDone(after));
  if (!candidate) return;
  const { after } = candidate;

  const [agent, board] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: agentId, userId },
      select: { displayName: true, userId: true },
    }),
    prisma.project.findUnique({
      where: { id: after.projectId },
      select: { ownerId: true, title: true, name: true, owner: { select: { email: true } } },
    }),
  ]);
  // Membership alone is not ownership: never email either party on another user's board.
  if (
    !agent || !board || board.ownerId !== agent.userId || !board.owner.email ||
    !(await isFeatureEnabled(HTPR_7028_FIRST_TASK_EMAIL_FLAG, board.ownerId))
  ) return;

  const claimed = await prisma.$transaction(async (tx) => {
    // Serialize the durable check-and-insert per user across every board and agent.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7028::int, ${userId}::int)`;
    if (await tx.logs.findFirst({ where: { LoggedById: userId, log: marker } })) return false;
    await tx.logs.create({
      data: { LoggedById: userId, log: marker, type: "Task", status: "Normal" },
    });
    return true;
  });
  if (!claimed) return;

  // Keep the claim even on failure: a lost provider response may already have delivered mail.
  const sharedLayout = await isFeatureEnabled(HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG, board.ownerId).catch(() => false);
  const { subject, html } = (sharedLayout ? renderAgentFirstTaskEmail : renderLegacyAgentFirstTaskEmail)({
    agentName: agent.displayName,
    taskTitle: after.title,
    boardName: board.title || board.name,
    projectId: after.projectId,
    uniqueIndex: after.uniqueIndex,
  });
  await sendEmail({
    to: board.owner.email,
    from: "Hypertask <notifications@hypertask.ai>",
    subject,
    html,
    headers: unsubscribeHeaders(userId, board.owner.email),
  });
  trackActivation(userId, "lifecycle_email_sent", { type: "agent_first_task" });
}
