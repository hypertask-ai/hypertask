import type { NextApiRequest, NextApiResponse } from "next";
import { timingSafeEqual } from "crypto";
import { getAuth } from "@/lib/firebase-admin";

function hasOwnerCliCredential(authorization: string): boolean {
  const secret = process.env.ANNOUNCEMENTS_SECRET_KEY;
  if (!secret) return false;

  const provided = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

/**
 * Authorizes announcement administrators. The owner CLI uses its dedicated
 * server-side credential; signed-in administrators use a non-revoked Firebase
 * ID token carrying the server-issued Boolean `admin` custom claim.
 */
export async function requireAnnouncementAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<boolean> {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string") {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  if (hasOwnerCliCredential(authorization)) return true;

  const match = authorization.match(/^Bearer\s+(\S+)$/);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  try {
    const claims = await getAuth().verifyIdToken(match[1], true);
    if (claims.admin !== true) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
}
