import { LogType, Status } from "@prisma/client";
import { fallbackBaseUrl } from "@/lib/auth/requestBaseUrl";
import { sendEmail } from "@/lib/email/sendEmail";
import { unsubscribeHeaders, unsubscribeUrl } from "@/lib/email/unsubscribe";
import { FEATURE_FLAG_QA_USER_ID, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7025_WELCOME_EMAIL_FLAG } from "@/lib/flags/keys";
import { MCP_ADD_COMMAND } from "@/lib/onboarding/installCommands";
import { isOnboardingQaArmed } from "@/lib/onboarding/qaArm";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { trackActivation } from "@/lib/telemetry/activationAnalytics";
import { onboardingEmailSkipReason } from "./eligibility";
import { renderOnboardingEmail } from "./layout";

export { WELCOME_COHORT_START } from "./eligibility";

export async function maybeSendWelcomeEmail(userId: number, opts?: { boardId?: number }) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { UserSetting: true },
    });
    if (!user) return "missing_user";
    const reason = onboardingEmailSkipReason(user);
    if (reason) return reason;

    const redis = await getRedis();
    const email = user.email.trim().toLowerCase();
    const armed = await isOnboardingQaArmed(email, redis);
    if (!await isFeatureEnabled(HTPR_7025_WELCOME_EMAIL_FLAG, armed ? FEATURE_FLAG_QA_USER_ID : userId)) return "flag_off";
    const sentKey = `onboarding:welcome-sent:${userId}`;
    if (await redis.get(sentKey) || await prisma.logs.findFirst({ where: { LoggedById: userId, log: "welcome_email_sent" } })) return "already_sent";

    const claimKey = `onboarding:welcome:${userId}`;
    if (!await redis.set(claimKey, new Date().toISOString(), "EX", 600, "NX")) return "already_claimed";
    let sent = false;
    try {
      const boardId = opts?.boardId ?? (await prisma.project.findFirst({
        where: { ownerId: userId, status: Status.Normal },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }) ?? await prisma.project.findFirst({
        where: { status: Status.Normal, members: { some: { userId, agentId: null } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }))?.id;
      const baseUrl = fallbackBaseUrl().replace(/\/$/, "");
      const message = renderOnboardingEmail({
        subject: "Your board is ready. Connect Claude Code in 30 seconds.",
        heading: "Your Hypertask board is live",
        paragraphs: [
          "Claude Code: run this, then type /mcp to sign in.",
          "Cursor and other MCP clients: copy the config from Settings > Connect > MCP.",
          "Then ask your agent to pick up the top task on your board.",
        ],
        code: MCP_ADD_COMMAND,
        cta: { label: "Open my board", url: boardId ? `${baseUrl}/project?id=${boardId}` : `${baseUrl}/` },
        unsubscribeUrl: unsubscribeUrl(userId, email),
      });
      await sendEmail({
        to: email,
        from: "Hypertask <notifications@hypertask.ai>",
        ...message,
        headers: unsubscribeHeaders(userId, email),
        idempotencyKey: `htpr-7025/user/${userId}`,
      });
      sent = true;
      void trackActivation(userId, "lifecycle_email_sent", { type: "welcome" });
      try {
        await prisma.logs.create({ data: { log: "welcome_email_sent", type: LogType.Signup, status: Status.Normal, LoggedById: userId } });
      } catch (error) {
        console.error("[onboarding/welcome] sent audit failed", error);
      }
      try {
        await redis.set(sentKey, new Date().toISOString());
      } catch (error) {
        console.error("[onboarding/welcome] sent marker failed", error);
      }
      return "sent";
    } catch (error) {
      // An accepted email must keep its claim even if the audit write fails.
      if (!sent) await redis.del(claimKey);
      await prisma.logs.create({ data: { log: "welcome_email_failed", type: LogType.Error, status: Status.Normal, LoggedById: userId } });
      throw error;
    }
  } catch (error) {
    console.error("[onboarding/welcome] failed", error);
    return "failed";
  }
}
