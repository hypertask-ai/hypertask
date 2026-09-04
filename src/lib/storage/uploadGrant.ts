import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived signed grant naming exactly the object keys one presign request
 * minted, and for whom (HTPR-5524 review).
 *
 * Without it, `/api/tasks/uploadFinalize` would authorize on the key prefix
 * alone, so any signed-in user who learned another user's attachment key could
 * ask for it to be deleted. The grant makes finalization a capability handed
 * back to the same caller, not a bucket-wide permission.
 */

export type UploadGrantFile = {
  key: string;
  fileName: string;
  contentType: string;
};

export type UploadGrant = {
  userId: number;
  keys: string[];
  taskLinkFiles?: UploadGrantFile[];
};

export type TaskAttachmentLinkReceipt = {
  userId: number;
  key: string;
  fileName: string;
  contentType: string;
  fileSize: number;
};

export const TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS = 24 * 60 * 60;

type SignedGrant = UploadGrant & { exp: number };
type SignedTaskAttachmentLinkReceipt = TaskAttachmentLinkReceipt & {
  purpose: "task-attachment-link";
  exp: number;
};

function secret(): string {
  const value = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) {
    throw new Error("Missing SESSION_SECRET or JWT_SECRET env var");
  }
  return value;
}

function encode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function signPayload(payload: object): string {
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifiedPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;

  const expected = Buffer.from(sign(encoded));
  const received = Buffer.from(signature);
  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString()
    ) as Record<string, unknown>;
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function signUploadGrant(grant: UploadGrant, ttlSeconds: number): string {
  return signPayload({
    ...grant,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  } satisfies SignedGrant);
}

export function verifyUploadGrant(token: unknown): UploadGrant | null {
  const payload = verifiedPayload(token);
  if (
    typeof payload?.userId !== "number" ||
    !Array.isArray(payload.keys) ||
    payload.keys.some((key) => typeof key !== "string")
  ) {
    return null;
  }

  const keys = payload.keys as string[];
  const taskLinkFiles = payload.taskLinkFiles;
  if (
    taskLinkFiles !== undefined &&
    (!Array.isArray(taskLinkFiles) ||
      taskLinkFiles.some(
        (file) =>
          typeof file !== "object" ||
          file === null ||
          typeof file.key !== "string" ||
          typeof file.fileName !== "string" ||
          typeof file.contentType !== "string" ||
          !keys.includes(file.key)
      ))
  ) {
    return null;
  }

  return {
    userId: payload.userId,
    keys,
    ...(taskLinkFiles
      ? { taskLinkFiles: taskLinkFiles as UploadGrantFile[] }
      : {}),
  };
}

export function signTaskAttachmentLinkReceipt(
  receipt: TaskAttachmentLinkReceipt,
  ttlSeconds: number
): string {
  return signPayload({
    ...receipt,
    purpose: "task-attachment-link",
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  } satisfies SignedTaskAttachmentLinkReceipt);
}

export function verifyTaskAttachmentLinkReceipt(
  token: unknown
): TaskAttachmentLinkReceipt | null {
  const payload = verifiedPayload(token);
  if (
    payload?.purpose !== "task-attachment-link" ||
    typeof payload.userId !== "number" ||
    typeof payload.key !== "string" ||
    typeof payload.fileName !== "string" ||
    typeof payload.contentType !== "string" ||
    typeof payload.fileSize !== "number" ||
    !Number.isSafeInteger(payload.fileSize) ||
    payload.fileSize < 0
  ) {
    return null;
  }
  return {
    userId: payload.userId,
    key: payload.key,
    fileName: payload.fileName,
    contentType: payload.contentType,
    fileSize: payload.fileSize,
  };
}
