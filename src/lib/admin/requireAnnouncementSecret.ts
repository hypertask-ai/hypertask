import type { NextApiRequest, NextApiResponse } from "next";
import { timingSafeEqual } from "crypto";

/**
 * Owner-only gate for the announcement admin endpoints. These are managed
 * exclusively by the owner CLI (scripts/announce.mjs) via
 * `Bearer ANNOUNCEMENTS_SECRET_KEY` (already provisioned in the app env).
 *
 * Fails closed: if the secret is unset the request is rejected, so a missing
 * env var can never silently re-open these endpoints to the internet.
 *
 * Usage:
 *   if (!requireAnnouncementSecret(req, res)) return;
 */
export function requireAnnouncementSecret(
  req: NextApiRequest,
  res: NextApiResponse
): boolean {
  const secret = process.env.ANNOUNCEMENTS_SECRET_KEY;
  const provided = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (
    !secret ||
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
