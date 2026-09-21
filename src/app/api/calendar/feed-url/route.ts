import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const dynamic = "force-dynamic";

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_ISSUER = process.env.JWT_ISSUER || "hypertask";
const CALENDAR_AUDIENCE = "calendar-feed";

/**
 * GET /api/calendar/feed-url
 * Returns the logged-in user's personal, long-lived subscribe URL for the ICS
 * feed. Paste the URL into Google Calendar (Other calendars → From URL).
 */
export async function GET(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const token = jwt.sign({ userId: session.userId }, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: CALENDAR_AUDIENCE,
    expiresIn: "365d",
  });

  const url = `${request.nextUrl.origin}/api/calendar/feed?token=${token}`;
  return NextResponse.json({ success: true, url });
}
