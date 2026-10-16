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
  const id = await createSignupContext(input, 600, request.headers.get("cookie"));
  if ((input as { method?: unknown } | null)?.method === "google") {
    return NextResponse.json({ signupContextId: id });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SIGNUP_CONTEXT_COOKIE, id ?? "", { ...signupContextCookieOptions, maxAge: id ? 600 : 0 });
  return response;
}
