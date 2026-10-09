import { LogType, Status } from "@prisma/client";
import { fallbackBaseUrl } from "@/lib/auth/requestBaseUrl";
import { sendEmail } from "@/lib/email/sendEmail";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { FEATURE_FLAG_QA_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7027_AGENT_NUDGE_EMAIL_FLAG } from "@/lib/flags/keys";
import { getFirstAgentConnection } from "@/lib/onboarding/agentConnection";
import { MCP_ADD_COMMAND } from "@/lib/onboarding/installCommands";
import prisma from "@/lib/prisma";
import { publishJob } from "@/lib/qstash";
import { getRedis } from "@/lib/redis";
import { onboardingEmailSkipReason, onboardingIdentitySkipReason } from "./eligibility";
import { renderOnboardingEmail } from "./layout";

const QUEUE_PATH = "/api/queues/agentNudgeEmailQueue";
const NUDGE_DELAY_MS = 24 * 60 * 60 * 1000;

export async function maybeScheduleAgentNudge(userId: number) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return "missing_user";
    const reason = onboardingIdentitySkipReason(user);
    if (reason) return reason;
    const redis = await getRedis();
    const email = user.email.trim().toLowerCase();
    const armed = Boolean(await redis.get(`onboarding:qa-armed:${email}`));
    if (!await isFeatureEnabled(HTPR_7027_AGENT_NUDGE_EMAIL_FLAG, armed ? FEATURE_FLAG_QA_USER_ID : userId)) return "flag_off";

    const scheduledKey = `onboarding:nudge-scheduled:${userId}`;
    if (await redis.get(scheduledKey)) return "already_scheduled";
    const claimKey = `onboarding:nudge-scheduling:${userId}`;
    if (!await redis.set(claimKey, new Date().toISOString(), "EX", 600, "NX")) return "already_scheduling";
    try {
      await publishJob({
        path: QUEUE_PATH,
        body: { userId },
        notBefore: Math.ceil((armed ? Date.now() + 120 * 1000 : user.joinedAt.getTime() + NUDGE_DELAY_MS) / 1000),
      });
      await redis.set(scheduledKey, new Date().toISOString());
      return "scheduled";
    } catch (error) {
      await redis.del(claimKey);
      throw error;
    }
  } catch (error) {
    console.error("[onboarding/agent-nudge] scheduling failed", error);
    return "failed";
  }
}

export async function sendAgentNudgeEmail(userId: number) {
  const skip = async (reason: string) => {
    await prisma.logs.create({ data: { log: `agent_nudge_email_skipped:${reason}`, type: LogType.Signup, status: Status.Normal, LoggedById: userId } });
    return reason;
  };
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { UserSetting: true } });
  if (!user) return "missing_user";
  const reason = onboardingEmailSkipReason(user);
  if (reason) return skip(reason);
  const redis = await getRedis();
  const email = user.email.trim().toLowerCase();
  const armed = Boolean(await redis.get(`onboarding:qa-armed:${email}`));
  if (!await isFeatureEnabled(HTPR_7027_AGENT_NUDGE_EMAIL_FLAG, armed ? FEATURE_FLAG_QA_USER_ID : userId)) return skip("flag_off");
  if (await getFirstAgentConnection(userId)) return skip("agent_connected");
  const sentKey = `onboarding:nudge-sent:${userId}`;
  if (await redis.get(sentKey) || await prisma.logs.findFirst({ where: { LoggedById: userId, log: "agent_nudge_email_sent" } })) return skip("already_sent");
  if (!armed && Date.now() < user.joinedAt.getTime() + NUDGE_DELAY_MS) {
    await publishJob({ path: QUEUE_PATH, body: { userId }, notBefore: Math.ceil((user.joinedAt.getTime() + NUDGE_DELAY_MS) / 1000) });
    return skip("too_early");
  }

  const claimKey = `onboarding:nudge:${userId}`;
  if (!await redis.set(claimKey, new Date().toISOString(), "EX", 600, "NX")) return "already_claimed";
  let sent = false;
  try {
    const baseUrl = fallbackBaseUrl().replace(/\/$/, "");
    const message = renderOnboardingEmail({
      subject: "Your agents can't see your board yet",
      heading: "Connect an agent to your board",
      paragraphs: [
        "Connecting Claude Code, Cursor or any MCP client takes one command:",
        "Hypertask confirms the connection as soon as your agent says hello. Then ask it to pick up the top task on your board.",
      ],
      code: MCP_ADD_COMMAND,
      cta: { label: "Connect an agent", url: `${baseUrl}/settings/mcp` },
      unsubscribeUrl: unsubscribeUrl(userId, email),
    });
    await sendEmail({
      to: email,
      from: "Hypertask <notifications@hypertask.ai>",
      ...message,
      headers: unsubscribeHeaders(userId, email),
      idempotencyKey: `htpr-7027/user/${userId}`,
    });
    // HTPR-7034: trackActivation(userId, "lifecycle_email_sent", { type: "agent_nudge" })
    sent = true;
    try {
      await prisma.logs.create({ data: { log: "agent_nudge_email_sent", type: LogType.Signup, status: Status.Normal, LoggedById: userId } });
    } catch (error) {
      console.error("[onboarding/agent-nudge] sent audit failed", error);
    }
    try {
      await redis.set(sentKey, new Date().toISOString());
    } catch (error) {
      console.error("[onboarding/agent-nudge] sent marker failed", error);
    }
    return "sent";
  } catch (error) {
    // An accepted email must keep its claim even if the audit write fails.
    if (!sent) await redis.del(claimKey);
    throw error;
  }
}
