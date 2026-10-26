import { isFeatureEnabled } from "@/lib/flags";
import { AGENT_WEBHOOK_AUTH_HEADER_FLAG } from "@/lib/flags/definitions/htpr-7905-agent-webhook-auth-header";
import { sealWebhookSigningKey } from "@/lib/webhooks/signingKeyStore";

const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const RESERVED_HEADER_NAMES = new Set([
  "host",
  "content-type",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "te",
  "trailer",
  "expect",
]);
const MAX_VALUE_LENGTH = 2000;

export type AuthHeaderChange =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "set"; name: string; sealedValue: string };

export class AuthHeaderInputError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

function text(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AuthHeaderInputError(`${field} must be a string`, field);
  return value;
}

export async function parseAuthHeaderChange(
  body: Record<string, unknown>,
  userId: number,
): Promise<AuthHeaderChange> {
  const name = text(body.authHeaderName, "authHeaderName");
  const value = text(body.authHeaderValue, "authHeaderValue");
  const bearer = text(body.bearerSecret, "bearerSecret");
  const clear = body.clearAuthHeader === true;
  if (body.clearAuthHeader !== undefined && typeof body.clearAuthHeader !== "boolean") {
    throw new AuthHeaderInputError("clearAuthHeader must be a boolean", "clearAuthHeader");
  }
  const supplied = name !== undefined || value !== undefined || bearer !== undefined;
  if (!supplied && !clear) return { kind: "keep" };
  if (!(await isFeatureEnabled(AGENT_WEBHOOK_AUTH_HEADER_FLAG, userId))) {
    throw new AuthHeaderInputError("Webhook auth headers are not available yet", "authHeaderName");
  }
  if (clear) {
    if (supplied) throw new AuthHeaderInputError("clearAuthHeader cannot be combined with a new header", "clearAuthHeader");
    return { kind: "clear" };
  }
  if (bearer !== undefined && (name !== undefined || value !== undefined)) {
    throw new AuthHeaderInputError("Use bearerSecret or authHeaderName with authHeaderValue, not both", "bearerSecret");
  }
  const headerName = bearer !== undefined ? "Authorization" : name?.trim();
  const rawValue = bearer !== undefined ? `Bearer ${bearer.trim()}` : value;
  if (!headerName) throw new AuthHeaderInputError("authHeaderName is required with authHeaderValue", "authHeaderName");
  if (!HEADER_NAME_PATTERN.test(headerName)) {
    throw new AuthHeaderInputError("authHeaderName must be 1 to 64 letters, digits or hyphens", "authHeaderName");
  }
  const lower = headerName.toLowerCase();
  if (RESERVED_HEADER_NAMES.has(lower) || lower.startsWith("x-hypertask-")) {
    throw new AuthHeaderInputError("authHeaderName is reserved", "authHeaderName");
  }
  const field = bearer !== undefined ? "bearerSecret" : "authHeaderValue";
  if (!rawValue || rawValue === "Bearer ") throw new AuthHeaderInputError(`${field} is required`, field);
  if (rawValue.length > MAX_VALUE_LENGTH || /[\r\n\0]/.test(rawValue)) {
    throw new AuthHeaderInputError(`${field} must be one line of ${MAX_VALUE_LENGTH} characters or less`, field);
  }
  return { kind: "set", name: headerName, sealedValue: sealWebhookSigningKey(rawValue) };
}

export function authHeaderColumns(change: AuthHeaderChange) {
  if (change.kind === "set") return { authHeaderName: change.name, authHeaderValue: change.sealedValue };
  if (change.kind === "clear") return { authHeaderName: null, authHeaderValue: null };
  return {};
}
