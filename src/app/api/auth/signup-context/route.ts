import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG } from "@/lib/flags/keys";
import { NextRequest, NextResponse } from "next/server";
import { createSignupContext, SIGNUP_CONTEXT_COOKIE, signupContextCookieOptions } from "@/lib/auth/signupAttributionContext";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip");
  const enabled = await isFeatureEnabled(HTPR_7269_SIGNUP_IDENTITY_LINK_FLAG, 0);
  const id = enabled ? await createSignupContext(input, 600, request.headers.get("cookie"), ip) : null;
  if ((input as { method?: unknown } | null)?.method === "google") {
    return NextResponse.json({ signupContextId: id });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SIGNUP_CONTEXT_COOKIE, id ?? "", { ...signupContextCookieOptions, maxAge: id ? 600 : 0 });
  return response;
}
