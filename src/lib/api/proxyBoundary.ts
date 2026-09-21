import { NextRequest, NextResponse } from "next/server";

import { isPublicApiPath } from "@/lib/api/authPolicy";

const WINDOW_MS = 60_000;
const REQUEST_LIMIT = 600;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(request: NextRequest, now = Date.now()): boolean {
  const key = clientKey(request);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  current.count += 1;
  return current.count > REQUEST_LIMIT;
}

export function resetApiRateLimitsForTests(): void {
  buckets.clear();
}

export function enforceApiBoundary(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith("/api")) return null;

  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  if (isPublicApiPath(request.nextUrl.pathname)) return null;
  if (!request.cookies.get("ht_session")?.value) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
