import prisma from "@/lib/prisma";
import { computeSeatQuantity } from "@/lib/seatQuantity";

/**
 * Resolve how many seats a team's Stripe subscription should carry: accepted
 * members (totalSeats) + distinct people invited but not yet accepted
 * (HTPR-3777). Pending invitees are found via the team's live projects.
 * Falls back to `fallbackQuantity` on any miss or error — a billing lookup
 * must never block the calling flow (checkout, team-leave).
 */
export async function resolveSeatQuantity(
  teamId: string | undefined,
  fallbackQuantity: number,
): Promise<number> {
  if (!teamId) return fallbackQuantity;
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        totalSeats: true,
        googleAccount: { select: { userId: true } },
        members: {
          where: { status: "Accepted" },
          select: { userId: true, user: { select: { email: true } } },
        },
        // Only live projects: invites on archived/deleted projects can never be
        // accepted. Only targeted invites: public links (key "public") never
        // expire and their emails[] holds past acceptors, not pending invitees.
        projects: {
          where: { status: "Normal" },
          select: {
            invites: {
              where: { expired: false, key: { not: "public" } },
              select: { emails: true },
            },
          },
        },
      },
    });
    if (!team) return fallbackQuantity;

    // GoogleAccount.user relation is disabled in the schema, so fetch the owner email directly.
    const ownerEmail = team.googleAccount?.userId
      ? (
          await prisma.user.findUnique({
            where: { id: team.googleAccount.userId },
            select: { email: true },
          })
        )?.email
      : null;

    // The persisted totalSeats counter is a display/cache field, not the billing
    // authority. Derive accepted seats from unique membership rows plus the owner so
    // historical counter drift cannot reintroduce a Stripe mismatch.
    const acceptedUserIds = new Set([
      ...(team.googleAccount?.userId ? [team.googleAccount.userId] : []),
      ...team.members.map((member) => member.userId),
    ]);

    // un-expired targeted invite = not yet accepted, so its emails[0] is the invitee
    return computeSeatQuantity({
      totalSeats: acceptedUserIds.size || team.totalSeats,
      pendingInviteEmails: team.projects.flatMap((p) =>
        p.invites.map((i) => i.emails[0]),
      ),
      memberEmails: [ownerEmail, ...team.members.map((m) => m.user.email)],
    });
  } catch (e) {
    console.error(
      e,
      "resolveSeatQuantity failed, falling back to fallback quantity",
    );
    return fallbackQuantity;
  }
}
