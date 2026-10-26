import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { createTask, validateProjectAccess } from "@/lib/mcp/tasks/services";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";
import {
  ERROR_TICKET_HOURLY_CAP,
  errorTicketMinimumOccurrences,
  errorFingerprint,
  isWithinErrorTicketCap,
  redactSecrets,
} from "./errorFingerprint";
import { claimThresholdErrorTicket } from "./errorTicketThreshold";
import { selectErrorBoardSection } from "./errorBoardTarget";
import { symbolicateStack } from "./symbolicateStack";
import { plainSummary, plainTitle } from "./plainIncident.mjs";
import { capturePostHogException } from "@/lib/telemetry/posthogErrorTracking";
import {
  DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE,
  SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE,
} from "@/lib/aiAllowancePolicy";
import { HTPR_7988_ALLOWANCE_ERROR_REPORT_FLAG, isFeatureEnabled } from "@/lib/flags";

export type ErrorReport = {
  message: string;
  stack?: string;
  url?: string;
  source: "client" | "server" | "handled";
  extra?: Record<string, string | number | boolean | null>;
  minimumOccurrences?: number;
  fingerprintKey?: string;
};

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

function ticketTitle(report: ErrorReport) {
  return plainTitle({
    url: report.url,
    source: report.source,
    message: report.message.replace(/\s+/g, " ").trim(),
  });
}

function ticketDescription(report: ErrorReport, firstSeen: string) {
  const extra = report.extra
    ? `\n\nExtra:\n${JSON.stringify(report.extra, null, 2)}`
    : "";
  const stack = `${report.stack || "Not provided"}${extra}`;
  return sanitizeRichHtml(
    `<p><strong>${escapeHtml(plainSummary({ url: report.url, source: report.source, message: report.message }))}</strong></p>` +
      `<ul>` +
      `<li>How often: first seen ${escapeHtml(firstSeen)}.</li>` +
      `<li>How bad: users affected unknown, check PostHog.</li>` +
      `<li>What to do next: a runner finds the cause, fixes it and rewrites this ticket with specifics.</li>` +
      `</ul>` +
      `<h3>Technical details</h3>` +
      `<ul>` +
      `<li><strong>Message:</strong> ${escapeHtml(report.message)}</li>` +
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

async function reportErrorTicket(report: ErrorReport) {
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
      creationChannel: "api",
      ...boardTarget,
      title: ticketTitle(report),
      description: ticketDescription(report, firstSeen),
      userId,
      priorityIndex: 0,
      estimateIndex: 0,
      labels: labelIds,
    });
    trace("created", { title: ticketTitle(report) });
  } catch (error) {
    console.error("[error-reporter] failed", error);
  }
}

export async function reportError(unredactedReport: ErrorReport) {
  if (
    (unredactedReport.message === SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE ||
      unredactedReport.message === DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE) &&
    await isFeatureEnabled(HTPR_7988_ALLOWANCE_ERROR_REPORT_FLAG, 0)
  ) return;

  const report: ErrorReport = {
    ...unredactedReport,
    message: redactSecrets(unredactedReport.message),
    stack: unredactedReport.stack === undefined ? undefined : redactSecrets(unredactedReport.stack),
  };
  const captured = await capturePostHogException(report);
  if (captured) {
    trace("posthog-captured");
    return;
  }
  await reportErrorTicket(report);
}
