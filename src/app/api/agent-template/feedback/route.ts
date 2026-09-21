import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { ipAddress } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  HTPR_6502_AGENT_TEMPLATE_INTAKE_FLAG,
  isFeatureEnabled,
} from "@/lib/flags";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { labelStore } from "@/utils/controllers/labels";
import { createTaskCore } from "@/utils/controllers/tasks/createTaskCore";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";

export const runtime = "nodejs";

const AGENT_TEMPLATE_PROJECT_ID = 5500;
const AGENT_TEMPLATE_INTAKE_SECTION = "Backlog";
const AGENT_TEMPLATE_INTAKE_AGENT_NAME = "Product Bot";
const MAX_REQUEST_BYTES = 32 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_PER_IP = 5;

const intakeSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(20_000),
    labels: z.array(z.string().trim().min(1).max(50)).max(8),
  })
  .strict();

function clientIp(request: NextRequest) {
  const value = ipAddress(request)?.trim();
  if (!value || !isIP(value)) {
    throw new Error("Trusted client IP is unavailable");
  }
  return value;
}

async function readBodyWithLimit(request: NextRequest) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function checkRateLimit(request: NextRequest) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart =
    Math.floor(nowSeconds / RATE_LIMIT_WINDOW_SECONDS) * RATE_LIMIT_WINDOW_SECONDS;
  const ipHash = createHash("sha256").update(clientIp(request)).digest("hex");
  const key = `agent-template:intake:${ipHash}:${windowStart}`;
  const redis = await getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);

  return {
    limited: count > RATE_LIMIT_PER_IP,
    retryAfter: Math.max(1, windowStart + RATE_LIMIT_WINDOW_SECONDS - nowSeconds),
  };
}

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { success: false, error },
    { status, headers },
  );
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Payload too large", 413);
  }

  let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;
  try {
    rateLimit = await checkRateLimit(request);
  } catch (error) {
    console.error("[agent-template-intake] rate limit unavailable", error);
    return jsonError("Feedback intake is temporarily unavailable", 503);
  }
  if (rateLimit.limited) {
    return jsonError("Rate limit exceeded", 429, {
      "Retry-After": String(rateLimit.retryAfter),
    });
  }

  try {
    const session = await getSessionUser(request.headers);
    if (
      !(await isFeatureEnabled(
        HTPR_6502_AGENT_TEMPLATE_INTAKE_FLAG,
        session?.userId ?? -1,
      ))
    ) {
      return jsonError("Not found", 404);
    }

    const rawBody = await readBodyWithLimit(request);
    if (rawBody === null) {
      return jsonError("Payload too large", 413);
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return jsonError("Invalid JSON", 400);
    }

    const parsed = intakeSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("Invalid feedback", 400);
    }

    const requestedLabels = [
      ...new Map(
        parsed.data.labels.map((label) => [label.toLowerCase(), label]),
      ).values(),
    ];
    const [project, availableLabels] = await Promise.all([
      prisma.project.findFirst({
        where: { id: AGENT_TEMPLATE_PROJECT_ID, status: "Normal" },
        select: {
          uniqueIdentifier: true,
          section: {
            where: {
              deleted: false,
              visibility: true,
              section_title: AGENT_TEMPLATE_INTAKE_SECTION,
            },
            take: 1,
            select: { id: true, section_title: true },
          },
          members: {
            where: {
              status: "Accepted",
              agent: {
                is: {
                  displayName: AGENT_TEMPLATE_INTAKE_AGENT_NAME,
                  revokedAt: null,
                },
              },
            },
            take: 1,
            select: { agent: { select: { id: true, userId: true } } },
          },
        },
      }),
      labelStore().findMany({
        where: { projectId: AGENT_TEMPLATE_PROJECT_ID },
        select: { id: true, value: true },
      }),
    ]);

    const section = project?.section[0];
    const intakeAgent = project?.members[0]?.agent;
    if (!project?.uniqueIdentifier || !section || !intakeAgent) {
      throw new Error("Agent Template intake destination is not configured");
    }

    const labelsByName = new Map<string, (typeof availableLabels)[number]>();
    availableLabels.forEach((label) => {
      if (label.value) labelsByName.set(label.value.toLowerCase(), label);
    });
    const missingLabels = requestedLabels.filter(
      (label) => !labelsByName.has(label.toLowerCase()),
    );
    if (missingLabels.length > 0) {
      return jsonError(`Unknown labels: ${missingLabels.join(", ")}`, 400);
    }

    const sanitizedBody = sanitizeRichHtml(parsed.data.body);
    if (!sanitizedBody.trim()) {
      return jsonError("Invalid feedback", 400);
    }

    // The server chooses Product Bot from the fixed board, so anonymous callers
    // cannot impersonate a person or choose an identity, board, or section.
    const { task } = await createTaskCore({
      title: parsed.data.title,
      description: sanitizedBody,
      userId: intakeAgent.userId,
      agentId: intakeAgent.id,
      projectId: AGENT_TEMPLATE_PROJECT_ID,
      sectionId: section.id,
      sectionTitle: section.section_title,
      projectIdentifier: project.uniqueIdentifier,
      createDrafts: false,
      labelIds: requestedLabels.map(
        (label) => labelsByName.get(label.toLowerCase())!.id,
      ),
    });

    return NextResponse.json(
      {
        success: true,
        task: {
          ticketNumber: task.ticketNumber,
          url: `https://app.hypertask.ai/detail/project-${AGENT_TEMPLATE_PROJECT_ID}/${task.uniqueIndex}`,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[agent-template-intake] task creation failed", error);
    return jsonError("Unable to file feedback", 500);
  }
}
