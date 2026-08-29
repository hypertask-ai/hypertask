import { SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE } from "@/lib/aiAllowancePolicy";

const HEARTBEAT_TURN_SUFFIX = /\n<!--ht-heartbeat:v1:([A-Za-z0-9_-]+)-->\s*$/;

/**
 * Set only when a streamed turn ended on the allowance error event, carrying
 * the allowance period that actually rejected so a caller can deduplicate
 * against it rather than a clock of its own.
 *
 * Matching that sentence anywhere in the body would also match the model
 * repeating it in its own reply, which inbox text can provoke, forging a "your
 * agent is paused" notice. Streamed content is JSON-escaped inside its `data:`
 * line, so it cannot fake the `event: error` line that has to sit immediately
 * above. `periodKey` is null when an older deployment streamed the stop without
 * one; the caller then falls back to its own claim period.
 */
export const streamStoppedOnSpentAllowance = (
  streamBody: string,
): { periodKey: string | null } | null => {
  const lines = streamBody.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() !== "event: error") continue;
    const data = lines[index + 1];
    if (!data?.startsWith("data: ")) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(data.slice("data: ".length));
    } catch {
      continue;
    }
    if (typeof payload !== "object" || payload === null) continue;
    const frame = payload as { content?: unknown; allowancePeriod?: unknown };
    if (frame.content !== SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE) continue;
    return {
      periodKey:
        typeof frame.allowancePeriod === "string" && frame.allowancePeriod
          ? frame.allowancePeriod
          : null,
    };
  }
  return null;
};

export type HeartbeatTurnMetadata = {
  version: 1;
  executionId: string;
  agentId: string;
  claimedAt: string;
  scanWatermark: string;
  previousHeartbeatAt: string | null;
};

const isMetadata = (value: unknown): value is HeartbeatTurnMetadata => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Partial<HeartbeatTurnMetadata>;
  return (
    metadata.version === 1 &&
    typeof metadata.executionId === "string" &&
    typeof metadata.agentId === "string" &&
    typeof metadata.claimedAt === "string" &&
    typeof metadata.scanWatermark === "string" &&
    (metadata.previousHeartbeatAt === null ||
      typeof metadata.previousHeartbeatAt === "string")
  );
};

export const encodeHeartbeatTurnMessage = (
  prompt: string,
  metadata: HeartbeatTurnMetadata,
) =>
  `${prompt}\n<!--ht-heartbeat:v1:${Buffer.from(
    JSON.stringify(metadata),
    "utf8",
  ).toString("base64url")}-->`;

export const decodeHeartbeatTurnMessage = (message: string) => {
  const match = message.match(HEARTBEAT_TURN_SUFFIX);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(match[1], "base64url").toString("utf8"),
    );
    if (!isMetadata(value)) return null;
    return {
      prompt: message.slice(0, match.index),
      metadata: value,
    };
  } catch {
    return null;
  }
};

export const decideDurableReservationRecovery = ({
  streamStarted,
  stale,
}: {
  streamStarted: boolean;
  stale: boolean;
}) => {
  if (streamStarted) return "reconcile" as const;
  return stale ? ("restore" as const) : ("wait" as const);
};

export const isNotificationInHeartbeatWindow = (
  createdAt: Date | string,
  previousHeartbeatAt: string | null,
  scanWatermark: string,
) => {
  const createdTime = new Date(createdAt).getTime();
  const previousTime = previousHeartbeatAt
    ? new Date(previousHeartbeatAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const watermarkTime = new Date(scanWatermark).getTime();
  return createdTime > previousTime && createdTime <= watermarkTime;
};
