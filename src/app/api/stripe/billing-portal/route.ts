import { NextResponse } from "next/server";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import { generateCustomerPortalLink } from "@/lib/subscription";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7980_STRIPE_PORTAL_BILLING_FLAG } from "@/lib/flags/definitions/htpr-7980-stripe-portal-billing";
import { createConfiguredBillingPortalSession } from "@/lib/stripeBillingPortal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const available = await isFeatureEnabled(HTPR_7980_STRIPE_PORTAL_BILLING_FLAG, user.id) &&
    Boolean(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim().startsWith("bpc_"));
  return NextResponse.json({ available }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getServerCookieUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  let body: { teamId?: unknown };
  try {
    body = (await request.json()) as { teamId?: unknown };
  } catch {
    return NextResponse.json({ message: "Invalid request" }, { status: 400 });
  }

  const teamId = typeof body.teamId === "string" ? body.teamId.trim() : "";
  if (!teamId) {
    return NextResponse.json({ message: "teamId required" }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      googleAccountId: true,
      stripe_customer_id: true,
    },
  });

  if (!team) {
    return NextResponse.json({ message: "Team not found" }, { status: 404 });
  }

  const isOwner =
    team.googleAccount.userId === user.id ||
    Boolean(user.accountId && user.accountId === team.googleAccountId);
  if (!isOwner) {
    return NextResponse.json(
      { message: "Only the team owner can update billing" },
      { status: 403 }
    );
  }

  if (!team.stripe_customer_id) {
    return NextResponse.json({ message: "No billing account" }, { status: 400 });
  }

  if (await isFeatureEnabled(HTPR_7980_STRIPE_PORTAL_BILLING_FLAG, user.id)) {
    try {
      const session = await createConfiguredBillingPortalSession(team.stripe_customer_id);
      return NextResponse.json({ url: session.url });
    } catch {
      return NextResponse.json(
        { message: "Billing portal configuration is unavailable" },
        { status: 503 },
      );
    }
  }

  const url = await generateCustomerPortalLink(team.stripe_customer_id);
  if (!url) {
    return NextResponse.json(
      { message: "Could not open billing portal" },
      { status: 500 }
    );
  }

  return NextResponse.json({ url });
}
