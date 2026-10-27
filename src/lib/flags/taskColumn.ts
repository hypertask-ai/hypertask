import type { FeatureFlagRow } from "@/lib/flags";

type Ticket = { uniqueIndex: number; description: string | null };
type Flag = Pick<FeatureFlagRow, "key" | "mode">;

export function unreleasedTicketFlags(ticket: Ticket, flags: readonly Flag[]): Flag[] {
  const mentioned = new Set(ticket.description?.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)+/g));
  return flags.filter((flag) =>
    flag.mode !== "EVERYONE" &&
    (flag.key.startsWith(`htpr-${ticket.uniqueIndex}-`) || mentioned.has(flag.key)),
  );
}
