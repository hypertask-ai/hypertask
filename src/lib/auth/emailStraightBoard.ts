import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import authConfig from "@/lib/configs/auth.config";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, clearBetterAuthSessionCookies, sessionCookieOptions, signSession } from "@/lib/auth/session";
import { slimUserForCookie } from "@/lib/auth/slimUserCookie";
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
import { STRAIGHT_BOARD_UID_PREFIX } from "@/lib/auth/unverifiedEmailAccount";

const signupCookieOptions = { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 600 * 60 * 24 * 7, path: "/" };
const JWT_ISSUER = process.env.JWT_ISSUER || "hypertask";
const JWT_VERIFICATION_AUDIENCE = process.env.JWT_VERIFICATION_AUDIENCE || "email-verification";

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

export async function finishStraightBoardEmailSignup(
  request: NextRequest,
  normalizedEmail: string,
  signupContextId: string | null,
  signupAttribution: SignupAttribution,
) {
  const userUpdateResult = await updateUsers(
    normalizedEmail,
    {
      uid: `${STRAIGHT_BOARD_UID_PREFIX}${crypto.randomUUID()}`,
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
  const loginBoard = await resolveLoginBoard(userData.id, request.cookies.get("previousBoard")?.value);
  const redirectPath = welcomeProjectId
    ? `/project?id=${welcomeProjectId}`
    : loginBoard === null
      ? "/onboarding"
      : authConfig.redirect.afterLogin;

  const response = NextResponse.json({ success: true, straightBoardRedirect: redirectPath });

  response.cookies.set("nookies_user", JSON.stringify({ ...slimUserForCookie(userData), straightBoardSignup: true }), signupCookieOptions);
  response.cookies.set(
    SESSION_COOKIE,
    signSession({ id: userData.id, email: userData.email }, SESSION_TTL_SECONDS),
    sessionCookieOptions(SESSION_TTL_SECONDS),
  );
  clearBetterAuthSessionCookies(response);

  const boardId = welcomeProjectId ?? (typeof loginBoard === "object" && loginBoard ? loginBoard.id : undefined);
  if (boardId) {
    response.cookies.set("previousBoard", `project-${boardId}|&|`, signupCookieOptions);
  }

  return { ok: true as const, response, userId: userData.id };
}
