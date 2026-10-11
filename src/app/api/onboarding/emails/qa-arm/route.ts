import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getRequestBaseUrl } from "@/lib/auth/requestBaseUrl";
import { FEATURE_FLAG_QA_USER, isFeatureEnabled } from "@/lib/flags";
import { HTPR_7025_WELCOME_EMAIL_FLAG, HTPR_7027_AGENT_NUDGE_EMAIL_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (session?.userId !== FEATURE_FLAG_QA_USER.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } });
    if (user?.email !== FEATURE_FLAG_QA_USER.email) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(getRequestBaseUrl(request)).origin) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const body = await request.json();
    const type = body?.type ?? "welcome";
    if (type !== "welcome" && type !== "agent_nudge") {
      return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
    }
    const flag = type === "agent_nudge" ? HTPR_7027_AGENT_NUDGE_EMAIL_FLAG : HTPR_7025_WELCOME_EMAIL_FLAG;
    if (!await isFeatureEnabled(flag, session.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) {
      return NextResponse.json({ error: "Email address already registered" }, { status: 409 });
    }
    const redis = await getRedis();
    await redis.set(`onboarding:qa-armed:${email}`, "1", "EX", 2 * 60 * 60);
    return NextResponse.json({ armed: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("[onboarding/qa-arm] failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
