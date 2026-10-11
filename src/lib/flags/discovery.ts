import type { FeatureFlagRow } from "@/lib/flags";

type FlagMetadata = Pick<FeatureFlagRow, "key" | "ticketId" | "ticketTitle" | "description" | "related">;

export function matchesFeatureFlagSearch(flag: FlagMetadata, query: string): boolean {
  const text = [flag.key, flag.ticketId, flag.ticketTitle, flag.description].join(" ").toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
}

function ticketId(flag: FlagMetadata): string | undefined {
  return /^(htpr|hyfa|yper4)-[1-9]\d*(?=-)/i.exec(flag.key)?.[0].toLowerCase()
    ?? flag.ticketId?.toLowerCase();
}

export function relatedFeatureFlags<T extends FlagMetadata>(flag: T, flags: readonly T[]): T[] {
  const ticket = ticketId(flag);
  const knownKeys = new Set(flags.map(({ key }) => key));
  const related = new Set(flag.related?.filter((key) => knownKeys.has(key)));
  return flags.filter((candidate) => candidate.key !== flag.key && (
    (ticket !== undefined && ticketId(candidate) === ticket)
    || related.has(candidate.key)
    || candidate.related?.includes(flag.key)
    || candidate.related?.some((key) => related.has(key))
  ));
}
