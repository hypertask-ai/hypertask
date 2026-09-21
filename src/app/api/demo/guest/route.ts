import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/betterAuth";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/auth/session";
import {
  GUEST_SESSION_TTL_SECONDS,
  isGuestUser,
} from "@/lib/demo/guest";
import {
  DemoBoardGenerationUnavailableError,
} from "@/lib/demo/generateDemoBoard";
import {
  provisionGuest,
  provisionGuestBoard,
  type GuestUserRecord,
} from "@/lib/demo/provisionGuest";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_GUESTS = 5;
const RATE_LIMIT_MAX_REGENERATIONS = 3;

// ponytail: this per-instance Map is intentionally naive. Upgrade to Upstash
// when anonymous traffic needs a shared rate limit across serverless instances.
const guestCreationsByIp = new Map<string, number[]>();
const boardRegenerationsByGuest = new Map<number, number[]>();

function requestIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function consumeGuestCreation(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const recent = (guestCreationsByIp.get(ip) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_GUESTS) {
    guestCreationsByIp.set(ip, recent);
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000)),
    };
  }
  recent.push(now);
  guestCreationsByIp.set(ip, recent);
  return { allowed: true, retryAfter: 0 };
}

function consumeBoardRegeneration(userId: number): {
  allowed: boolean;
  retryAfter: number;
} {
  const now = Date.now();
  const recent = (boardRegenerationsByGuest.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_REGENERATIONS) {
    boardRegenerationsByGuest.set(userId, recent);
    return {
      allowed: false,
      retryAfter: Math.max(
        1,
        Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000),
      ),
    };
  }
  recent.push(now);
  boardRegenerationsByGuest.set(userId, recent);
  return { allowed: true, retryAfter: 0 };
}

// HTPR-4303: on Better-Auth-enabled deployments (prod + previews) the board's
// first render hits BA-gated APIs, and the client-side legacy->BA bridge in
// useAuth fires too late (fire-and-forget after mount) -> 401s -> the prod
// build throws to the route error boundary. Mint the BA session server-side
// through the existing tested /bridge-session endpoint so the guest lands
// fully authenticated, exactly like a real login. Returns false on failure so
// callers can fail loud instead of redirecting to a crashing board.
async function appendBetterAuthCookies(
  origin: string,
  legacyToken: string,
  response: NextResponse,
): Promise<boolean> {
  if (process.env.BETTER_AUTH_ENABLED !== "1") return true;

  try {
    const bridged = await auth.handler(
      new Request(new URL("/api/auth/bridge-session", origin), {
        method: "POST",
        // origin must be a trusted origin or Better Auth rejects the POST.
        headers: { cookie: `${SESSION_COOKIE}=${legacyToken}`, origin },
      }),
    );
    if (!bridged.ok) {
      console.error(
        "guest Better Auth bridge failed",
        bridged.status,
        await bridged.text().catch(() => ""),
      );
      return false;
    }
    for (const cookie of bridged.headers.getSetCookie()) {
      // The bridge sub-request carries no cookies, so the legacy plugin's
      // theme default would override this route's amoled. Ours wins.
      if (cookie.startsWith("theme=")) continue;
      response.headers.append("set-cookie", cookie);
    }
    return true;
  } catch (error) {
    console.error("guest Better Auth bridge errored", error);
    return false;
  }
}

function setGuestCookies(
  response: NextResponse,
  user: GuestUserRecord,
  legacyToken: string,
) {
  response.cookies.set(
    SESSION_COOKIE,
    legacyToken,
    sessionCookieOptions(GUEST_SESSION_TTL_SECONDS),
  );
  response.cookies.set("nookies_user", JSON.stringify(slimUserForCookie(user)), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GUEST_SESSION_TTL_SECONDS,
    path: "/",
  });
  // Onboarding runs on AMOLED: true black is the look the demo sells.
  response.cookies.set("theme", "amoled", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GUEST_SESSION_TTL_SECONDS,
    path: "/",
  });
}

async function getExistingGuest(request: NextRequest) {
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    include: { UserSetting: true, userPicture: true },
  });
  if (
    !user ||
    !isGuestUser(user) ||
    (session.email && session.email !== user.email)
  ) {
    return null;
  }

  const project = await prisma.project.findFirst({
    where: { ownerId: user.id, status: "Normal", teamId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      googleAccountId: true,
      teamId: true,
      uniqueIdentifier: true,
    },
  });
  const googleAccountId = project?.googleAccountId ?? user.accountId;
  if (
    !project?.uniqueIdentifier ||
    !project.teamId ||
    !googleAccountId
  ) {
    return null;
  }

  return {
    projectId: project.id,
    boardUrl: `/project?id=${project.id}`,
    uniqueIdentifier: project.uniqueIdentifier,
    owner: {
      userId: user.id,
      googleAccountId,
      teamId: project.teamId,
    },
  };
}

async function existingGuestResponse(
  request: NextRequest,
  payload: {
    projectId: number;
    boardUrl: string;
    uniqueIdentifier: string;
  },
) {
  const response = NextResponse.json({
    projectId: payload.projectId,
    boardUrl: payload.boardUrl,
    uniqueIdentifier: payload.uniqueIdentifier,
  });
  // Returning guests may predate the BA mint (or the BA session expired);
  // the bridge is a no-op when a matching BA session already exists.
  const legacyToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (
    legacyToken &&
    !(await appendBetterAuthCookies(
      request.nextUrl.origin,
      legacyToken,
      response,
    ))
  ) {
    return NextResponse.json(
      { error: "guest session unavailable" },
      { status: 500 },
    );
  }
  return response;
}

export async function POST(request: NextRequest) {
  // A real account must never be provisioned a guest: setGuestCookies would
  // overwrite their session and silently sign them out. getSessionUser, not the
  // legacy cookie alone, because a Better Auth session outlives ht_session.
  const sessionUser = await getSessionUser(request.headers);
  if (sessionUser) {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.userId },
      select: { uid: true },
    });
    if (user && !isGuestUser(user)) {
      return NextResponse.json({
        projectId: null,
        boardUrl: "/",
        uniqueIdentifier: null,
      });
    }
  }

  let purpose = "";
  let validJson = true;
  try {
    purpose = String((await request.json())?.purpose ?? "").trim();
  } catch {
    validJson = false;
  }

  const existingGuest = await getExistingGuest(request);
  if (existingGuest && !purpose) {
    return existingGuestResponse(request, existingGuest);
  }

  if (!validJson) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // HTPR-4875: no purpose = the default /demo entry, which provisions an empty
  // board with no AI generation. A purpose still has to be a real description.
  if (purpose && purpose.length < 3) {
    return NextResponse.json({ error: "purpose too short" }, { status: 400 });
  }
  if (purpose.length > 200) purpose = purpose.slice(0, 200);

  if (purpose && !process.env.DEMO_AI_GATEWAY_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "demo generation unavailable" },
      { status: 503 },
    );
  }

  if (existingGuest) {
    const rateLimit = consumeBoardRegeneration(existingGuest.owner.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "too many new demo boards" },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter) },
        },
      );
    }

    try {
      const board = await provisionGuestBoard(purpose, existingGuest.owner);
      // HTPR-4999: keep the previous boards. The first (seeded) board holds the
      // CLI/MCP onboarding tasks and the guest should be able to switch back;
      // the 24h guest cleanup cron still removes everything.
      return existingGuestResponse(request, board);
    } catch (error) {
      if (error instanceof DemoBoardGenerationUnavailableError) {
        return NextResponse.json(
          { error: "demo generation unavailable" },
          { status: 503 },
        );
      }
      console.error("guest demo regeneration failed", error);
      return NextResponse.json(
        { error: "guest board regeneration failed" },
        { status: 500 },
      );
    }
  }

  const rateLimit = consumeGuestCreation(requestIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "too many demo boards" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) },
      },
    );
  }

  try {
    const guest = await provisionGuest(purpose);
    const response = NextResponse.json({
      projectId: guest.projectId,
      boardUrl: guest.boardUrl,
      uniqueIdentifier: guest.uniqueIdentifier,
    });
    const legacyToken = signSession(
      { id: guest.userRecord.id, email: guest.userRecord.email },
      GUEST_SESSION_TTL_SECONDS,
    );
    setGuestCookies(response, guest.userRecord, legacyToken);
    if (
      !(await appendBetterAuthCookies(
        request.nextUrl.origin,
        legacyToken,
        response,
      ))
    ) {
      return NextResponse.json(
        { error: "guest session unavailable" },
        { status: 500 },
      );
    }
    return response;
  } catch (error) {
    if (error instanceof DemoBoardGenerationUnavailableError) {
      return NextResponse.json(
        { error: "demo generation unavailable" },
        { status: 503 },
      );
    }
    console.error("guest demo provisioning failed", error);
    return NextResponse.json(
      { error: "guest provisioning failed" },
      { status: 500 },
    );
  }
}
