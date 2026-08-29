import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createTask, validateProjectAccess } from "@/lib/mcp/tasks/services";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import {
  ERROR_TICKET_HOURLY_CAP,
  errorTicketMinimumOccurrences,
  errorFingerprint,
  isWithinErrorTicketCap,
} from "./errorFingerprint";
import { claimThresholdErrorTicket } from "./errorTicketThreshold";
import { selectErrorBoardSection } from "./errorBoardTarget";
import { symbolicateStack } from "./symbolicateStack";

export type ErrorReport = {
  message: string;
  stack?: string;
  url?: string;
  source: "client" | "server" | "handled";
  extra?: Record<string, string | number | boolean | null>;
  minimumOccurrences?: number;
  fingerprintKey?: string;
};

// A daily cron that fails daily used to refile every night: a 24h window expired
// minutes before the next run, so every occurrence looked like the first. The
// window has to outlast the slowest recurring producer, not match it (HTPR-5571).
const DEDUPE_SECONDS = 7 * 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;
const ERROR_LABEL = "auto-error";

function positiveEnvInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function ticketTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return `[auto] ${normalized.slice(0, 90)}`;
}

function ticketDescription(report: ErrorReport, firstSeen: string) {
  const extra = report.extra
    ? `\n\nExtra:\n${JSON.stringify(report.extra, null, 2)}`
    : "";
  const stack = `${report.stack || "Not provided"}${extra}`;
  return sanitizeRichHtml(
    `<p><strong>An automated production error needs investigation.</strong></p>` +
      `<ul>` +
      `<li><strong>URL:</strong> ${escapeHtml(report.url || "Unknown")}</li>` +
      `<li><strong>Source:</strong> ${escapeHtml(report.source)}</li>` +
      `<li><strong>First seen:</strong> ${escapeHtml(firstSeen)}</li>` +
      `<li><strong>Stack:</strong><pre>${escapeHtml(stack)}</pre></li>` +
      `</ul>`,
  );
}

async function getBoardTarget(projectId: number, userId: number) {
  const configuredSectionTitle = process.env.ERROR_BOARD_SECTION_TITLE?.trim();

  const projectResult = await validateProjectAccess(projectId, userId);
  if (projectResult.error) throw new Error(projectResult.error.message);

  const sections = await prisma.section.findMany({
    where: {
      projectId,
      visibility: true,
      deleted: false,
    },
    select: {
      id: true,
      section_title: true,
    },
  });
  const section = selectErrorBoardSection(sections, configuredSectionTitle);

  const projectUniqueIdentifier = projectResult.project.uniqueIdentifier;
  if (!projectUniqueIdentifier)
    throw new Error("Error board identifier is missing");

  // Tags every auto-filed ticket so the board can filter to just these (saved view "Auto errors").
  // Missing label is not fatal: the ticket still gets created, just untagged.
  const label = await prisma.label.findFirst({
    where: { projectId, value: ERROR_LABEL },
    select: { id: true },
  });

  const target = {
    projectId,
    sectionId: section.id,
    sectionTitle: section.section_title,
    projectUniqueIdentifier,
    teamId: projectResult.project.teamId,
    labelIds: label ? [label.id] : [],
  };
  return target;
}

function trace(step: string, extra?: Record<string, unknown>) {
  console.log("[error-reporter]", step, extra ? JSON.stringify(extra) : "");
}

export async function reportError(report: ErrorReport) {
  try {
    if (
      process.env.NODE_ENV !== "production" ||
      process.env.VERCEL_ENV === "preview"
    ) {
      trace("skip-env", {
        nodeEnv: process.env.NODE_ENV,
        vercelEnv: process.env.VERCEL_ENV,
      });
      return;
    }

    const symbolicated =
      report.source === "client"
        ? await symbolicateStack(report.stack)
        : { stack: report.stack || "", resolvedFrames: 0 };
    if (symbolicated.resolvedFrames > 0) {
      report = { ...report, stack: symbolicated.stack };
    }

    const redis = await getRedis();
    const fingerprint = report.fingerprintKey
      ? errorFingerprint(`category:${report.fingerprintKey}`)
      : errorFingerprint(report.message, report.stack);
    const minimumOccurrences = errorTicketMinimumOccurrences(
      report.minimumOccurrences,
    );

    if (minimumOccurrences > 1) {
      // Deliberately NOT DEDUPE_SECONDS: that is how long a filed ticket stays
      // quiet, not how long occurrences may accumulate toward the threshold.
      // Passing the widened window here would make threshold-gated errors fire on
      // a week of stragglers instead of a day's burst.
      const thresholdClaim = await claimThresholdErrorTicket(
        redis,
        fingerprint,
        minimumOccurrences,
      );
      if (!thresholdClaim.claimed) {
        trace("threshold-unclaimed", {
          fingerprint: fingerprint.slice(0, 12),
          occurrenceCount: thresholdClaim.occurrenceCount,
          minimumOccurrences,
        });
        return;
      }
    } else {
      const dedupeKey = `errors:dedupe:${fingerprint}`;
      const firstOccurrence = await redis.set(
        dedupeKey,
        "1",
        "EX",
        DEDUPE_SECONDS,
        "NX",
      );

      if (!firstOccurrence) {
        const duplicateKey = `errors:duplicates:${fingerprint}`;
        const duplicateCount = await redis.incr(duplicateKey);
        if (duplicateCount === 1) {
          await redis.expire(duplicateKey, DEDUPE_SECONDS);
        }
        trace("duplicate", { fingerprint: fingerprint.slice(0, 12) });
        return;
      }
    }

    const hour = Math.floor(Date.now() / (HOUR_SECONDS * 1000));
    const hourlyKey = `errors:tickets:${hour}`;
    const hourlyCount = await redis.incr(hourlyKey);
    if (hourlyCount === 1) await redis.expire(hourlyKey, HOUR_SECONDS);
    if (!isWithinErrorTicketCap(hourlyCount, ERROR_TICKET_HOURLY_CAP)) {
      trace("cap-exceeded", { hourlyCount });
      return;
    }

    const projectId = positiveEnvInt("ERROR_BOARD_PROJECT_ID", 1534);
    const userId = positiveEnvInt("ERROR_REPORTER_USER_ID", 6);
    const target = await getBoardTarget(projectId, userId);
    const firstSeen = new Date().toISOString();
    trace("creating", {
      fingerprint: fingerprint.slice(0, 12),
      projectId: target.projectId,
      sectionId: target.sectionId,
      resolvedFrames: symbolicated.resolvedFrames,
    });

    const { labelIds, ...boardTarget } = target;
    await createTask({
      ...boardTarget,
      title: ticketTitle(report.message),
      description: ticketDescription(report, firstSeen),
      userId,
      priorityIndex: 0,
      estimateIndex: 0,
      labels: labelIds,
    });
    trace("created", { title: ticketTitle(report.message) });
  } catch (error) {
    console.error("[error-reporter] failed", error);
  }
}
