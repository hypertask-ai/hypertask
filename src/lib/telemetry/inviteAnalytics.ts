import { MemberRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isActivationEligible } from "./activationAnalytics";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";
import { scheduleAnalytics } from "./signupAnalytics";

type Invitation = { id: string; userId: number; projectId: number };

export function recordInviteSent(
  invite: Invitation,
  method: "email" | "link",
  inviterUserId = invite.userId,
): void {
  const occurredAt = new Date();
  scheduleAnalytics(async () => {
    if (!(await isActivationEligible(inviterUserId))) return;
    const project = await prisma.project.findUnique({ where: { id: invite.projectId }, select: { teamId: true } });
    if (!project) return;
    const eventId = `invite_sent:${invite.id}`;
    await captureAnalyticsOccurrence(inviterUserId, "invite_sent", `analytics:${eventId}`, {
      ...serverAnalyticsProperties(inviterUserId, project.teamId, invite.projectId, eventId, occurredAt),
      invitation_id: invite.id, invite_method: method, role: MemberRole.Member,
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
    if (!(await isActivationEligible(userId))) return;
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { teamId: true, ownerId: true } });
    if (!project || project.ownerId === userId) return;
    const member = await prisma.member.findUnique({ where: { id: membershipId }, select: { role: true, acceptedAt: true } });
    if (!member) return;
    const eventId = `member_joined:${membershipId}`;
    await captureAnalyticsOccurrence(userId, "member_joined", `analytics:${eventId}`, async (tx) => ({
      ...serverAnalyticsProperties(userId, project.teamId, projectId, eventId, member.acceptedAt ?? occurredAt),
      membership_id: String(membershipId), invitation_id: invitationId, inviter_user_id: inviterUserId === null ? null : String(inviterUserId),
      role: member.role,
      member_count: 1 + await tx.member.count({ where: { projectId, agentId: null, status: "Accepted", userId: { not: project.ownerId } } }),
    }), { scope: "business" });
  });
}
