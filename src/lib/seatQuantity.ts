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
