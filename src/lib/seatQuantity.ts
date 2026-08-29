/**
 * Seat-count math for Stripe checkout (HTPR-3777).
 *
 * `totalSeats` already counts the owner as 1 and every accepted member. But at
 * onboarding the owner invites N people *before* any of them accept, so
 * totalSeats is still 1 and billing only that under-charges. Worse, when the
 * last invitee accepts, totalSeats exceeds the paid quantity and Stripe
 * auto-invoices the difference: a surprise charge.
 *
 * So the quantity we bill = totalSeats (owner + accepted) + the distinct people
 * invited but not yet accepted (and not already on the team). Those pending
 * seats are pre-purchased, and invitees fill them for free as they accept.
 *
 * Pure on purpose (no imports) so it stays unit-testable: see seatQuantity.check.ts.
 */
export function computeSeatQuantity(opts: {
  totalSeats: number;
  pendingInviteEmails: (string | null | undefined)[];
  memberEmails: (string | null | undefined)[];
}): number {
  const members = new Set(
    opts.memberEmails.filter(Boolean).map((e) => e!.toLowerCase()),
  );
  const pending = new Set(
    opts.pendingInviteEmails
      .filter(Boolean)
      .map((e) => e!.toLowerCase())
      .filter((e) => !members.has(e)),
  );
  return opts.totalSeats + pending.size;
}
