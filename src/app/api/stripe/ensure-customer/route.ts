import { NextResponse } from "next/server";
import { createCustomerIfNull } from "@/lib/subscription";
import { getServerCookieUser } from "@/lib/auth/serverUser";
import prisma from "@/lib/prisma";
import hasTeamOwnerOrProjectAdminAccess from "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getServerCookieUser();
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let teamId: string | undefined;
  try {
    teamId = (await request.json())?.teamId;
  } catch {
    teamId = undefined;
  }
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const team = await prisma.team.findFirst({
    where: { id: teamId },
    select: {
      id: true,
      googleAccountId: true,
      stripe_customer_id: true,
      googleAccount: { select: { userId: true } },
    },
  });
  if (!team?.googleAccount) {
    return NextResponse.json({ error: "team not found" }, { status: 404 });
  }

  const allowed = await hasTeamOwnerOrProjectAdminAccess(
    user.id,
    user.accountId,
    team,
    teamId,
    null
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (team.stripe_customer_id) {
    return NextResponse.json({ stripe_customer_id: team.stripe_customer_id });
  }

  let stripeCustomerId: string | undefined;
  try {
    stripeCustomerId = await createCustomerIfNull(user.email, teamId);
  } catch (error) {
    console.error("ensure-customer: provisioning failed", { teamId, error });
    return NextResponse.json(
      { error: "billing account could not be created" },
      { status: 500 }
    );
  }

  if (!stripeCustomerId) {
    console.error("ensure-customer: provisioning returned no customer", { teamId });
    return NextResponse.json(
      { error: "billing account could not be created" },
      { status: 500 }
    );
  }

  return NextResponse.json({ stripe_customer_id: stripeCustomerId });
}
