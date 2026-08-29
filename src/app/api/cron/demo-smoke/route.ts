import { NextRequest, NextResponse } from "next/server";

import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { deleteGuestCascade } from "@/lib/demo/cleanupGuest";
import { GUEST_SEED_TASK_TITLES } from "@/lib/demo/guestSeedTasks";
import { provisionGuest } from "@/lib/demo/provisionGuest";
import { reportError } from "@/lib/errors/reportError";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FAILURE_REPORT_WINDOW_MS = 60 * 60 * 1000;
const failureReports = new Map<string, number>();

function errorDetails(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : null;

  return { name, message, code };
}

function claimFailureReport(signature: string): boolean {
  const now = Date.now();
  const lastReportedAt = failureReports.get(signature);
  if (
    lastReportedAt !== undefined &&
    now - lastReportedAt < FAILURE_REPORT_WINDOW_MS
  ) {
    return false;
  }

  failureReports.set(signature, now);
  return true;
}

function releaseFailureReport(signature: string): void {
  failureReports.delete(signature);
}

export async function GET(request: NextRequest) {
  if (
    !hasValidCronAuthorization(
      request.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let deleted = 0;
  try {
    let guest: Awaited<ReturnType<typeof provisionGuest>> | null = null;

    try {
      guest = await provisionGuest("");
      if (!Number.isInteger(guest.projectId) || guest.projectId <= 0) {
        throw new Error("Demo guest provisioning returned no projectId");
      }

      const tasks = await prisma.task.findMany({
        where: { projectId: guest.projectId, status: { not: "Deleted" } },
        select: { title: true },
      });
      const taskTitles = new Set(tasks.map((task) => task.title));
      const missingTitles = GUEST_SEED_TASK_TITLES.filter(
        (title) => !taskTitles.has(title),
      );
      if (missingTitles.length > 0) {
        throw new Error(
          `Demo board is missing seed tasks: ${missingTitles.join(", ")}`,
        );
      }
    } finally {
      if (guest) {
        await deleteGuestCascade(guest.userId);
        deleted = 1;
      }
    }

    return NextResponse.json({ deleted, failed: [] });
  } catch (error) {
    const details = errorDetails(error);
    const signature = `${details.name}:${details.code ?? "none"}:${details.message}`;

    if (claimFailureReport(signature)) {
      try {
        await reportError({
          message: `Demo smoke failed: ${details.name}: ${details.message}`,
          stack: error instanceof Error ? error.stack : undefined,
          url: "/api/cron/demo-smoke",
          source: "handled",
          fingerprintKey: `demo-smoke:${signature}`,
          extra: {
            errorName: details.name,
            errorMessage: details.message,
            prismaCode: details.code,
          },
        });
      } catch (reportingError) {
        // Release the claim: a swallowed reporting failure would otherwise mute
        // this signature for an hour and leave a broken demo unannounced.
        releaseFailureReport(signature);
        console.error("demo smoke failure went unreported", reportingError);
      }
    }

    return NextResponse.json(
      { deleted, failed: [details.message] },
      { status: 500 },
    );
  }
}
