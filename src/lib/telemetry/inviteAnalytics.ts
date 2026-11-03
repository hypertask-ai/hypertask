import { createHash } from "node:crypto";
import { enqueueAnalyticsIntent } from "./analyticsIntents";
import { MemberRole, type Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isActivationEligible } from "./activationAnalytics";
import { captureAnalyticsOccurrence, serverAnalyticsProperties } from "./analyticsOccurrences";

type Invitation = { id: string; userId: number; projectId: number };

export function pseudonymousInvitationId(invitationId: string): string {
  return createHash("sha256").update(`hypertask:invitation:${invitationId}`).digest("hex").slice(0, 32);
}

export type InviteSentPayload = { invite: Invitation; method: "email" | "link"; inviterUserId: number; occurredAt: string };
export type MemberJoinedPayload = { membershipId: number; userId: number; projectId: number; invitationId: string | null; inviterUserId: number | null; occurredAt: string };

export async function enqueueInviteSent(
  db: Pick<Prisma.TransactionClient, "analyticsIntent">,
  invite: Invitation,
  method: "email" | "link",
  inviterUserId = invite.userId,
): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "invite_sent", payload: {
    invite: { id: invite.id, userId: invite.userId, projectId: invite.projectId }, method, inviterUserId, occurredAt: new Date().toISOString(),
  } });
}

export async function captureInviteSent(payload: InviteSentPayload): Promise<void> {
  const { invite, method, inviterUserId } = payload;
  const occurredAt = new Date(payload.occurredAt);
  if (!(await isActivationEligible(inviterUserId))) return;
  const project = await prisma.project.findUnique({ where: { id: invite.projectId }, select: { teamId: true } });
  if (!project) return;
  const invitationId = pseudonymousInvitationId(invite.id);
  const eventId = `invite_sent:${invitationId}`;
  await captureAnalyticsOccurrence(inviterUserId, "invite_sent", `analytics:${eventId}`, {
    ...serverAnalyticsProperties(inviterUserId, project.teamId, invite.projectId, eventId, occurredAt),
    invitation_id: invitationId, invite_method: method, role: MemberRole.Member,
  }, { scope: "business" });
}

export async function enqueueMemberJoined(
  db: Pick<Prisma.TransactionClient, "analyticsIntent">,
  membershipId: number,
  userId: number,
  projectId: number,
  invitationId: string | null = null,
  inviterUserId: number | null = null,
): Promise<string> {
  return enqueueAnalyticsIntent(db, { kind: "member_joined", payload: { membershipId, userId, projectId, invitationId, inviterUserId, occurredAt: new Date().toISOString() } });
}

export async function captureMemberJoined(payload: MemberJoinedPayload): Promise<void> {
  const { membershipId, userId, projectId, invitationId, inviterUserId } = payload;
  const occurredAt = new Date(payload.occurredAt);
  if (!(await isActivationEligible(userId))) return;
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
}
