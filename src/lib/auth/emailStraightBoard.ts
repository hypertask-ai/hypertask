import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import authConfig from "@/lib/configs/auth.config";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG } from "@/lib/flags/definitions/htpr-7553-email-straight-board";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearBetterAuthSessionCookies,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
import { seedResponseThemeCookie } from "@/lib/auth/themeCookie";
import { adoptGuestBoards } from "@/utils/controllers/demo/adoptGuestBoards";
import { resolveLoginBoard } from "@/utils/controllers/demo/resolveLoginBoard";
import updateUsers from "@/utils/controllers/users/update_or_create_user";
import { provisionFirstWorkspace } from "@/utils/controllers/users/provisionFirstWorkspace";
import { companyRoleOptions, companySizeOptions } from "@/lib/constants/constants";
import type { SignupAttribution } from "@/lib/telemetry/signupAnalytics";
import jwt from "jsonwebtoken";
import { sendEmail } from "@/lib/email/sendEmail";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import type { IUser } from "@/models/model";
import { isGuestUser } from "@/lib/demo/guest";

export const STRAIGHT_BOARD_SIGNUP_COOKIE = "ht_straight_board_signup";

const JWT_ISSUER = process.env.JWT_ISSUER || "hypertask";
const JWT_VERIFICATION_AUDIENCE =
  process.env.JWT_VERIFICATION_AUDIENCE || "email-verification";

function verificationJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("Missing JWT_SECRET env var");
  return jwtSecret;
}

function createVerificationToken(email: string) {
  return jwt.sign({ sub: email }, verificationJwtSecret(), {
    expiresIn: "30m",
    issuer: JWT_ISSUER,
    audience: JWT_VERIFICATION_AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
}

export async function sendSignupVerificationEmail(
  request: NextRequest,
  to: string,
  utmData: Record<string, string | undefined> = {},
) {
  const url = new URL(`${getRequestBaseUrl(request)}/verify-email`);
  url.searchParams.set("token", createVerificationToken(to));
  for (const [key, value] of Object.entries(utmData)) {
    if (value) url.searchParams.set(key, value);
  }
  const link = url.toString();
  if (!process.env.RESEND_API_KEY) {
    console.log("Verification link (no Resend):", link);
    return;
  }
  await sendEmail({
    to,
    from: `Hypertask <${process.env.EMAIL_FROM || "noreply@hypertask.ai"}>`,
    subject: "Verify your email - Hypertask",
    html: `<p><a href="${link}">Verify your email</a></p>`,
  });
}

export async function sessionEmailUnverified(userId: number) {
  const prisma = (await import("@/lib/prisma")).default;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true, UserSetting: { select: { isVerified: true } } },
  });
  if (!user) return false;
  return !(user.emailVerified || user.UserSetting?.isVerified);
}

export async function straightBoardSignupRequesterAllowed(requestingUserId: number) {
  if (!(await isFeatureEnabled(HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG, requestingUserId).catch(() => false))) return false;
  const requester = await (await import("@/lib/prisma")).default.user.findUnique({
    where: { id: requestingUserId },
    select: { uid: true },
  });
  return !isGuestUser(requester);
}

export async function blockUnverifiedStraightBoardInvite(userId: number) {
  if (!(await isFeatureEnabled(HTPR_7553_EMAIL_STRAIGHT_BOARD_FLAG, userId).catch(() => false))) {
    return false;
  }
  return sessionEmailUnverified(userId).catch(() => false);
}

export function isPlausibleSignupEmail(normalizedEmail: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
}

function boardRedirectPath(
  loginBoard: Awaited<ReturnType<typeof resolveLoginBoard>>,
  projectId?: number,
) {
  if (loginBoard === null) return "/onboarding";
  if (projectId) return `/project?id=${projectId}`;
  return authConfig.redirect.afterLogin;
}

const straightBoardCookieOptions = {
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 60 * 60 * 24 * 14,
  path: "/",
};

export async function finishStraightBoardEmailSignup(
  request: NextRequest,
  normalizedEmail: string,
  signupContextId: string | null,
  signupAttribution: SignupAttribution,
) {
  const userUpdateResult = await updateUsers(
    normalizedEmail,
    {
      uid: `email_${crypto.randomUUID()}`,
      displayName: normalizedEmail.split("@")[0],
      photoURL: undefined,
    },
    true,
    authConfig.onboarding.skipOnboarding,
    false,
    signupAttribution,
    signupContextId,
    request.headers.get("cookie"),
  );

  if (userUpdateResult.status !== 200 || !userUpdateResult.res.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: "Failed to create user account", code: "USER_CREATION_FAILED" },
        { status: userUpdateResult.status === 200 ? 500 : userUpdateResult.status },
      ),
    };
  }

  const userData = userUpdateResult.res.user as IUser;
  let welcomeProjectId: number | undefined;

  if (userUpdateResult.res.isNewUser && authConfig.onboarding.skipOnboarding) {
    try {
      const onboardingResult = await provisionFirstWorkspace(
        userData as IUser,
        request.cookies.get(SESSION_COOKIE)?.value,
        "MyTeam",
        "MyBoard",
        companySizeOptions[0],
        companyRoleOptions[0],
      );
      welcomeProjectId = onboardingResult?.Project?.id;
    } catch (error) {
      console.error("Straight-board email signup provisioning failed:", error);
    }
  }

  await adoptGuestBoards(request.cookies.get(SESSION_COOKIE)?.value, userData.id);
  const loginBoard = await resolveLoginBoard(
    userData.id,
    request.cookies.get("previousBoard")?.value,
  );
  const redirectPath = boardRedirectPath(loginBoard, welcomeProjectId);

  const response = NextResponse.json({
    success: true,
    straightBoardRedirect: redirectPath,
  });

  response.cookies.set("nookies_user", JSON.stringify(slimUserForCookie(userData)), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600 * 60 * 24 * 7,
    path: "/",
  });
  response.cookies.set(
    SESSION_COOKIE,
    signSession({ id: userData.id, email: userData.email }, SESSION_TTL_SECONDS),
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );
  response.cookies.set(STRAIGHT_BOARD_SIGNUP_COOKIE, "1", straightBoardCookieOptions);
  clearBetterAuthSessionCookies(response);
  seedResponseThemeCookie(request, response);

  const boardId =
    welcomeProjectId ?? (typeof loginBoard === "object" && loginBoard ? loginBoard.id : undefined);
  if (boardId) {
    response.cookies.set("previousBoard", `project-${boardId}|&|`, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600 * 60 * 24 * 7,
      path: "/",
    });
  }

  return { ok: true as const, response, userId: userData.id };
}

export function clearStraightBoardSignupCookie(response: NextResponse) {
  response.cookies.set(STRAIGHT_BOARD_SIGNUP_COOKIE, "", { ...straightBoardCookieOptions, maxAge: 0 });
}
