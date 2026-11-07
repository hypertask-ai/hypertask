import { randomBytes } from "node:crypto";
import { ipAddress } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_7552_AGENT_CODE_SIGNIN_FLAG, isFeatureEnabled } from "@/lib/flags";
import { getRedis } from "@/lib/redis";
import {
  approveDevicePairing, claimDevicePairing, denyDevicePairing, deliverDeviceCredential,
  DEVICE_DELIVERY_RETRY_MS, DEVICE_PAIRING_COOKIE, DEVICE_PAIRING_SECONDS, DevicePairingError,
  deviceClientNameSchema, deviceCodeSchema, deviceHash, devicePairingStatus,
  deviceSecretSchema, deviceVerifierSchema, ownedDevicePairing, startDevicePairing,
} from "@/lib/auth/devicePairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const flowInput = z.object({ id: z.string().uuid() }).strict();
const claimantInput = flowInput.extend({ claimant: deviceSecretSchema, verifier: deviceVerifierSchema }).strict();
const claimInput = z.object({
  code: deviceCodeSchema, claimant: deviceSecretSchema, challenge: deviceSecretSchema,
  clientName: deviceClientNameSchema, verifier: deviceVerifierSchema.optional(),
}).strict();
const RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if redis.call('TTL', KEYS[1]) < 0 then return -1 end
return count
`;

function rememberBrowser(response: NextResponse, secret: string, expiresAt: Date) {
  const maxAge = Math.max(60, Math.ceil((expiresAt.getTime() + DEVICE_DELIVERY_RETRY_MS - Date.now()) / 1000));
  response.cookies.set(DEVICE_PAIRING_COOKIE, secret, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge });
  return response;
}

async function throttle(key: string, limit: number, seconds: number) {
  const redis = await getRedis();
  const count = await redis.eval(RATE_LIMIT, 1, `device_pairing:${key}`, seconds);
  if (typeof count !== "number" || count < 1 || count > limit) return false;
  return true;
}

async function readBody(request: NextRequest): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new DevicePairingError("invalid_grant");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new DevicePairingError("invalid_grant", 413);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DevicePairingError("invalid_grant");
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    if (!["start", "status", "approve", "deny", "claim", "token"].includes(action)) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: HEADERS });
    }
    const clientIp = deviceHash(ipAddress(request) ?? "unknown");
    if (!await throttle(`ip:${clientIp}`, action === "claim" ? 10 : 30, 60) ||
      !await throttle("global", 1000, 60)) {
      return NextResponse.json({ error: "slow_down" }, { status: 429, headers: { ...HEADERS, "Retry-After": "10" } });
    }
    const body = await readBody(request);
    if (action === "claim") {
      const input = claimInput.parse(body);
      if (!await throttle(`code:${deviceHash(input.code)}`, 10, DEVICE_PAIRING_SECONDS)) {
        return NextResponse.json({ error: "slow_down" }, { status: 429, headers: { ...HEADERS, "Retry-After": "10" } });
      }
      return NextResponse.json(await claimDevicePairing(input), { headers: HEADERS });
    }
    if (action === "token") {
      const input = claimantInput.parse(body);
      return NextResponse.json(await deliverDeviceCredential(input.id, input.claimant, input.verifier), { headers: HEADERS });
    }
    if (request.headers.get("origin") !== request.nextUrl.origin || request.headers.has("authorization")) {
      throw new DevicePairingError("access_denied", 403);
    }
    const user = await loadCurrentUser(request.headers);
    if (!user || user.agentId || user.source === "cli-bearer") throw new DevicePairingError("access_denied", 403);
    if (!await isFeatureEnabled(HTPR_7552_AGENT_CODE_SIGNIN_FLAG, user.userId)) {
      throw new DevicePairingError("access_denied", 403);
    }
    if (action === "start") {
      z.object({}).strict().parse(body);
      if (!await throttle(`owner:${user.userId}`, 5, 3600)) {
        return NextResponse.json({ error: "slow_down" }, { status: 429, headers: HEADERS });
      }
      const browserSecret = randomBytes(32).toString("base64url");
      const result = await startDevicePairing(user.userId, browserSecret);
      return rememberBrowser(NextResponse.json(result, { headers: HEADERS }), browserSecret, result.expiresAt);
    }
    const { id } = flowInput.parse(body);
    const browserSecret = deviceSecretSchema.parse(request.cookies.get(DEVICE_PAIRING_COOKIE)?.value);
    if (action === "approve") {
      const status = await approveDevicePairing(user.userId, browserSecret, id);
      return rememberBrowser(NextResponse.json(status, { headers: HEADERS }), browserSecret, new Date(status.expiresAt));
    }
    if (action === "deny") return NextResponse.json(await denyDevicePairing(user.userId, browserSecret, id), { headers: HEADERS });
    const status = devicePairingStatus(await ownedDevicePairing(user.userId, browserSecret, id));
    return rememberBrowser(NextResponse.json(status, { headers: HEADERS }), browserSecret, new Date(status.expiresAt));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "invalid_grant" }, { status: 400, headers: HEADERS });
    if (error instanceof DevicePairingError) return NextResponse.json({ error: error.code }, { status: error.status, headers: HEADERS });
    console.warn("[device-pairing] Request failed closed");
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: HEADERS });
  }
}
