import { NextRequest, NextResponse } from "next/server";

import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6536_QA_LOGIN_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { seedResponseThemeCookie } from "@/lib/auth/themeCookie";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearBetterAuthSessionCookies,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import {
  QA_LOGIN_USER_ID,
  getQaLoginConfig,
  isQaLoginConfigured,
  normalizeQaLoginEmail,
  qaLoginCredentialsMatch,
} from "@/lib/auth/qaLogin";
import {
  claimQaLoginAttempt,
  getQaLoginClientIp,
} from "@/lib/auth/qaLoginRateLimit";

function logQaLogin(outcome: string, email: string) {
  console.info("[qa-login]", { outcome, email });
}

function invalidCredentials() {
  return NextResponse.json(
    { success: false, error: "Invalid email or password" },
    { status: 401 },
  );
}

async function isQaLoginFlagOn() {
  try {
    return await isFeatureEnabled(HTPR_6536_QA_LOGIN_FLAG, QA_LOGIN_USER_ID);
  } catch {
    return true;
  }
}

export async function POST(request: NextRequest) {
  if (!isQaLoginConfigured()) {
    return new NextResponse(null, { status: 404 });
  }

  if (!(await isQaLoginFlagOn())) {
    return new NextResponse(null, { status: 404 });
  }

  const config = getQaLoginConfig();
  if (!config) {
    return new NextResponse(null, { status: 404 });
  }

  const clientIp = getQaLoginClientIp(request);
  if (!clientIp) {
    logQaLogin("unavailable", "");
    return NextResponse.json(
      { success: false, error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }

  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
    };
    email = typeof body.email === "string" ? body.email : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    logQaLogin("invalid_body", "");
    return NextResponse.json(
      { success: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  const normalizedEmail = normalizeQaLoginEmail(email);
  if (!normalizedEmail || !password || normalizedEmail.length > 320) {
    logQaLogin("invalid_body", normalizedEmail);
    return NextResponse.json(
      { success: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  const attempt = await claimQaLoginAttempt(normalizedEmail, clientIp);
  if (!attempt.allowed) {
    logQaLogin("rate_limited", normalizedEmail);
    return NextResponse.json(
      { success: false, error: "Too many sign-in attempts. Try again later." },
      { status: 429 },
    );
  }

  if (!qaLoginCredentialsMatch(normalizedEmail, password, config)) {
    logQaLogin("invalid", normalizedEmail);
    return invalidCredentials();
  }

  const userData = await prisma.user.findFirst({
    where: { email: config.email },
    select: {
      id: true,
      email: true,
      displayName: true,
      photoURL: true,
      uid: true,
    },
  });

  if (!userData || userData.id !== QA_LOGIN_USER_ID) {
    logQaLogin("wrong_user", normalizedEmail);
    return invalidCredentials();
  }

  const ownedBoard = await prisma.project.findFirst({
    where: { ownerId: userData.id },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const redirectUrl = ownedBoard ? `/project?id=${ownedBoard.id}` : "/";
  const response = NextResponse.json({
    success: true,
    redirectUrl,
  });

  response.cookies.set(
    "nookies_user",
    JSON.stringify(slimUserForCookie(userData)),
    {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    },
  );
  response.cookies.set(
    SESSION_COOKIE,
    signSession(
      { id: userData.id, email: userData.email },
      SESSION_TTL_SECONDS,
    ),
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );
  clearBetterAuthSessionCookies(response);
  seedResponseThemeCookie(request, response);

  if (ownedBoard) {
    response.cookies.set("previousBoard", `project-${ownedBoard.id}|&|`, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });
  }

  logQaLogin("success", normalizedEmail);
  return response;
}
