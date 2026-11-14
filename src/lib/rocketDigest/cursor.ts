export type AnnouncementDigest = {
  until?: string;
  ticketIds?: number[];
  runAt?: string;
};

export function announcementDigest(body: unknown): AnnouncementDigest | null {
  if (!body || typeof body !== "object") return null;
  const digest = (body as { digest?: unknown }).digest;
  if (!digest || typeof digest !== "object") return null;
  return digest as AnnouncementDigest;
}

export function digestUntil(body: unknown): Date | null {
  const until = announcementDigest(body)?.until;
  if (typeof until !== "string") return null;
  const parsed = new Date(until);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
