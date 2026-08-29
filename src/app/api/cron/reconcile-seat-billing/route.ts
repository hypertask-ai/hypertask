import { NextRequest, NextResponse } from "next/server";

import { isSubscriptionActive } from "@/lib/constants/constants";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import {
  pendingStripeCancellationId,
  PENDING_STRIPE_CANCELLATION_KEY,
} from "@/lib/pendingStripeSubscriptionCancellation";
import prisma from "@/lib/prisma";
import { reconcileSeatBillingForTeam } from "@/lib/syncSeatBilling";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEAM_BATCH = 100;
const CONCURRENCY = 4;

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const summary = {
    scanned: 0,
    reconciled: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };
  let cursor: string | undefined;

  while (true) {
    const teams = await prisma.team.findMany({
      where: {
        OR: [
          {
            subscriptionPlan: {
              some: {
                subscriptionStatus: { in: ["Paid", "active", "trialing"] },
              },
            },
          },
          {
            subscriptionPlan: {
              some: {
                subscriptionObject: {
                  path: [PENDING_STRIPE_CANCELLATION_KEY],
                  string_starts_with: "sub_",
                },
              },
            },
          },
        ],
      },
      orderBy: { id: "asc" },
      take: TEAM_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        subscriptionPlan: {
          select: {
            subscriptionStatus: true,
            subscriptionObject: true,
          },
        },
      },
    });
    if (teams.length === 0) break;

    for (let offset = 0; offset < teams.length; offset += CONCURRENCY) {
      await Promise.all(
        teams.slice(offset, offset + CONCURRENCY).map(async (team) => {
          summary.scanned += 1;
          if (
            !team.subscriptionPlan.some(
              (plan) =>
                isSubscriptionActive(plan.subscriptionStatus) ||
                pendingStripeCancellationId(plan.subscriptionObject),
            )
          ) {
            summary.skipped += 1;
            return;
          }
          const result = await reconcileSeatBillingForTeam(team.id);
          if (result === "RECONCILED") summary.reconciled += 1;
          else if (result === "OK") summary.unchanged += 1;
          else if (result === "SKIPPED") summary.skipped += 1;
          else summary.failed += 1;
        }),
      );
    }

    cursor = teams.at(-1)?.id;
    if (teams.length < TEAM_BATCH) break;
  }

  return NextResponse.json(summary, { status: summary.failed ? 207 : 200 });
}
