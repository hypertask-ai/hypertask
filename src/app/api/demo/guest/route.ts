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
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "request body must be a JSON object" },
        { status: 400 },
      );
    }
    if (body.purpose !== undefined && typeof body.purpose !== "string") {
      return NextResponse.json(
        { error: "purpose must be a string" },
        { status: 400 },
      );
    }
    purpose = (body.purpose ?? "").trim();
  } catch {
    return NextResponse.json(
      { error: "request body must be valid JSON" },
      { status: 400 },
    );
  }

  const existingGuest = await getExistingGuest(request);
  if (existingGuest && !purpose) {
    return existingGuestResponse(request, existingGuest);
  }
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
      return existingGuestResponse(request, board);
    } catch (error) {
      if (error instanceof DemoBoardGenerationUnavailableError) {
        return NextResponse.json(
          { error: "demo generation unavailable" },
          { status: 503 },
        );
      }
      console.error(
        "guest demo regeneration failed",
        error instanceof Error ? error.message : String(error),
        error,
      );
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
    console.error(
      "guest demo provisioning failed",
      error instanceof Error ? error.message : String(error),
      error,
    );
    return NextResponse.json(
      { error: "guest provisioning failed" },
      { status: 500 },
    );
  }
}
