import { LogType, Status } from "@prisma/client";
import prisma from "@/lib/prisma";
import { FEATURE_FLAG_QA_USER_ID, HTPR_7026_AGENT_CONNECT_CHECK_FLAG, HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { isOnboardingQaArmed } from "@/lib/onboarding/qaArm";
import { getRedis } from "@/lib/redis";
import { sendEmail } from "@/lib/email/sendEmail";
import { renderAgentConnectedEmail } from "@/lib/onboarding/emails/agentConnected";
import { renderAgentConnectedEmail as renderLegacyAgentConnectedEmail } from "@/utils/controllers/notifications/emailTemplates";

const CLIENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  claude: "Claude",
  chatgpt: "ChatGPT",
  vscode: "VS Code",
};

function firstConnectionRow(userId: number, since?: Date) {
  return prisma.logs.findFirst({
    where: {
      LoggedById: userId,
      ...(since ? { createdAt: { gt: since } } : {}),
      OR: [
        { log: "cli_token_exchange" },
        { log: { startsWith: "mcp_connected" } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, createdAt: true, log: true },
  });
}

async function connectionClient(userId: number, row: { log: string; createdAt: Date }) {
  const explicitClient = CLIENT_NAMES[row.log.split(":")[1]];
  if (explicitClient) return explicitClient;
  const choice = await prisma.logs.findFirst({
    where: {
      LoggedById: userId,
      log: { startsWith: "onboarding_ai_choice:" },
      createdAt: { lte: row.createdAt },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { log: true },
  });
  return CLIENT_NAMES[choice?.log.split(":")[1] ?? ""] ??
    (row.log === "cli_token_exchange" ? "Hypertask CLI" : "Your MCP agent");
}

export async function getFirstAgentConnection(
  userId: number,
  since?: Date,
): Promise<{ at: Date; client: string } | null> {
  const row = await firstConnectionRow(userId, since);
  return row ? { at: row.createdAt, client: await connectionClient(userId, row) } : null;
}

export async function isAgentConnectCheckEnabledFor(userId: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  let armed = false;
  if (user?.email) {
    try {
      armed = await isOnboardingQaArmed(user.email, await getRedis());
    } catch {
      // A Redis outage must not grant QA eligibility or disable a user's own flag.
    }
  }
  return isFeatureEnabled(HTPR_7026_AGENT_CONNECT_CHECK_FLAG, armed ? FEATURE_FLAG_QA_USER_ID : userId);
}

export async function sendFirstAgentConnectedEmail(userId: number, logId: number): Promise<void> {
  try {
    if (!(await isAgentConnectCheckEnabledFor(userId))) return;
    const first = await firstConnectionRow(userId);
    if (!first || first.id !== logId) return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user?.email) return;
    const client = await connectionClient(userId, first);
    const board = await prisma.project.findFirst({
      where: { ownerId: userId, status: Status.Normal },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const sharedLayout = await isFeatureEnabled(HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG, userId).catch(() => false);
    const email = (sharedLayout ? renderAgentConnectedEmail : renderLegacyAgentConnectedEmail)(client, board?.id);
    // This existing unique (userId, eventType) key claims the send across instances.
    // Keep the claim on failure: an uncertain provider response must not duplicate mail.
    try {
      await prisma.webhookEvent.create({ data: { userId, eventType: "agent_connected_email" } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return;
      throw error;
    }
    await sendEmail({
      to: user.email,
      from: "Hypertask <notifications@hypertask.ai>",
      ...email,
    });
    await prisma.webhookEvent.update({
      where: { userId_eventType: { userId, eventType: "agent_connected_email" } },
      data: { success: true },
    });
    // HTPR-7034: trackActivation(userId, "lifecycle_email_sent", { type: "agent_connected" })
  } catch {
    console.error("Agent connection email failed");
  }
}

export async function getAgentConnectCardState(userId: number) {
  const eligible = await isAgentConnectCheckEnabledFor(userId);
  if (!eligible) return { eligible, connected: false, dismissed: false };
  const [connection, dismissed, board] = await Promise.all([
    getFirstAgentConnection(userId),
    prisma.logs.findFirst({
      where: { LoggedById: userId, log: "agent_connect_dismissed" },
      select: { id: true },
    }),
    prisma.project.findFirst({
      where: { ownerId: userId, status: Status.Normal },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);
  return { eligible, connected: !!connection, at: connection?.at, client: connection?.client, dismissed: !!dismissed, boardId: board?.id };
}

export async function dismissAgentConnectCard(userId: number): Promise<void> {
  await prisma.logs.create({
    data: { LoggedById: userId, log: "agent_connect_dismissed", type: LogType.Signup, status: Status.Normal },
  });
}
