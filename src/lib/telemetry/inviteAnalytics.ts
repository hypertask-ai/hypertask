import { createHash } from "node:crypto";
import { MemberRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HTPR_7268_INVITE_SEAT_ANALYTICS_FLAG, isFeatureEnabled } from "@/lib/flags";
import { isActivationEligible } from "./activationAnalytics";
import { captureActivationOccurrence } from "./activationOccurrences";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { scheduleAnalytics } from "./signupAnalytics";

type Invitation = { id: string; userId: number; projectId: number };

export async function isInviteSeatAnalyticsEnabled(userId: number): Promise<boolean> {
  return await isActivationEligible(userId) && await isFeatureEnabled(HTPR_7268_INVITE_SEAT_ANALYTICS_FLAG, userId);
}

export function pseudonymousInvitationId(invitationId: string): string {
  return createHash("sha256").update(`hypertask:invitation:${invitationId}`).digest("hex").slice(0, 32);
}

export function recordInviteSent(
  invite: Invitation,
  method: "email" | "link",
  inviterUserId = invite.userId,
): void {
  const occurredAt = new Date();
  scheduleAnalytics(async () => {
    if (!(await isInviteSeatAnalyticsEnabled(inviterUserId))) {
      await captureActivationOccurrence(inviterUserId, "teammate_invited", invite.id, { method });
      return;
    }
    const project = await prisma.project.findUnique({ where: { id: invite.projectId }, select: { teamId: true } });
    if (!project) return;
    const invitationId = pseudonymousInvitationId(invite.id);
    const eventId = `invite_sent:${invitationId}`;
    await captureAnalyticsOccurrence(inviterUserId, "invite_sent", `analytics:${eventId}`, {
      ...serverAnalyticsProperties(inviterUserId, project.teamId, invite.projectId, eventId, occurredAt),
      invitation_id: invitationId, invite_method: method, role: MemberRole.Member,
    }, { scope: "business" });
  });
}

export function recordMemberJoined(
  membershipId: number,
  userId: number,
  projectId: number,
  invitationId: string | null = null,
  inviterUserId: number | null = null,
): void {
  const occurredAt = new Date();
  scheduleAnalytics(async () => {
    if (!(await isInviteSeatAnalyticsEnabled(userId))) {
      if (invitationId !== null && inviterUserId !== null) {
        await captureActivationOccurrence(inviterUserId, "invite_accepted", `${invitationId}:${userId}`, { inviteeId: userId });
      }
      return;
    }
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true, ownerId: true } });
    if (!project || project.ownerId === userId) return;
    const member = await prisma.member.findUnique({ where: { id: membershipId }, select: { role: true, acceptedAt: true } });
    if (!member) return;
    const eventId = `member_joined:${membershipId}`;
    await captureAnalyticsOccurrence(userId, "member_joined", `analytics:${eventId}`, async (tx) => ({
      ...serverAnalyticsProperties(userId, project.teamId, projectId, eventId, member.acceptedAt ?? occurredAt),
      membership_id: String(membershipId),
      invitation_id: invitationId === null ? null : pseudonymousInvitationId(invitationId),
      inviter_user_id: inviterUserId === null ? null : String(inviterUserId),
      role: member.role,
      member_count: 1 + await tx.member.count({ where: { projectId, agentId: null, status: "Accepted", userId: { not: project.ownerId } } }),
    }), { scope: "business" });
  });
}
