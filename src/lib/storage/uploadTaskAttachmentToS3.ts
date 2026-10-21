import {
  getHypertasksS3Client,
  getHypertasksStoragePublicUrl,
  HYPERTASKS_S3_BUCKET,
  HYPERTASKS_STORAGE_PUBLIC_BASE_URL,
  parseHypertasksStorageKeyFromUrl,
} from "@/lib/storage/hypertasksS3";
import { createHash } from "node:crypto";
import { MCP_ATTACHMENT_STORAGE_TIMEOUT_MS } from "@/lib/mcp/attachments/constants";

export const TASK_ATTACHMENT_PREFIX = "tasks/attachments";
export const AI_CHAT_ATTACHMENT_PREFIX = "ai-chat/attachments";


function safeFileNameSegment(fileName: string): string {
  return fileName.replace(/\s+/g, "_").replace(/[/\\]/g, "_");
}

function safeDeterministicFileNameSegment(fileName: string): string {
  const digest = createHash("sha256").update(fileName).digest("hex").slice(0, 16);
  const display = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 200);
  return `${display}_${digest}`;
}

function safePathSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

export async function uploadTaskAttachmentToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  storageKey?: string,
  signal?: AbortSignal
): Promise<string> {
  const s3 = getHypertasksS3Client();

  const timenow = Date.now();
  const safeName = safeFileNameSegment(fileName);
  const key = storageKey ?? `${TASK_ATTACHMENT_PREFIX}/${timenow}_${safeName}`;

  const upload = s3.upload({
    Bucket: HYPERTASKS_S3_BUCKET,
    ContentType: contentType,
    Key: key,
    Body: buffer,
  });
  const abortUpload = () => upload.abort();
  if (signal?.aborted) {
    upload.abort();
  } else {
    signal?.addEventListener("abort", abortUpload, { once: true });
  }
  if (!storageKey) {
    try {
      await upload.promise();
      return getHypertasksStoragePublicUrl(key);
    } finally {
      signal?.removeEventListener("abort", abortUpload);
    }
  }
  const timer = setTimeout(
    () => upload.abort(),
    MCP_ATTACHMENT_STORAGE_TIMEOUT_MS
  );
  try {
    await upload.promise();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortUpload);
  }

  return getHypertasksStoragePublicUrl(key);
}

export function buildTaskAttachmentStorageKey(input: {
  taskId: number;
  targetKey: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}): string {
  const digest = createHash("sha256").update(input.buffer).digest("hex");
  const contentTypeDigest = createHash("sha256")
    .update(input.contentType.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const filenameDigest = createHash("sha256")
    .update(input.fileName)
    .digest("hex")
    .slice(0, 16);
  return `${TASK_ATTACHMENT_PREFIX}/${input.taskId}_${safePathSegment(input.targetKey)}_${digest}_${contentTypeDigest}_${filenameDigest}_${safeDeterministicFileNameSegment(input.fileName)}`;
}

export async function uploadAiChatAttachmentToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  sessionId: string
): Promise<string> {
  const s3 = getHypertasksS3Client();

  const timenow = Date.now();
  const safeName = safeFileNameSegment(fileName);
  const safeSessionId = safePathSegment(sessionId);
  const key = `${AI_CHAT_ATTACHMENT_PREFIX}/${safeSessionId}/${timenow}_${safeName}`;

  await s3
    .upload({
      Bucket: HYPERTASKS_S3_BUCKET,
      ContentType: contentType,
      Key: key,
      Body: buffer,
    })
    .promise();

  return getHypertasksStoragePublicUrl(key);
}

const MANAGED_ATTACHMENT_PREFIXES = [
  `${TASK_ATTACHMENT_PREFIX}/`,
  `${AI_CHAT_ATTACHMENT_PREFIX}/`,
] as const;

function isManagedHypertasksAttachmentKey(key: string): boolean {
  return MANAGED_ATTACHMENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function parseHypertasksAttachmentKeyFromUrl(
  fileSource: string
): string | null {
  try {
    const key = parseHypertasksStorageKeyFromUrl(fileSource);
    if (!key) {
      console.warn(
        "[parseHypertasksAttachmentKeyFromUrl] Skipping unexpected URL:",
        fileSource
      );
      return null;
    }
    if (!isManagedHypertasksAttachmentKey(key)) {
      return null;
    }
    return key;
  } catch (error: any) {
    console.log("🚀 ~ parseHypertasksAttachmentKeyFromUrl ~ error:", error);
    return null;
  }
}

export function isDeterministicTaskAttachmentForTarget(
  fileSource: string,
  taskId: number,
  targetKey: string
): boolean {
  const key = parseHypertasksStorageKeyFromUrl(fileSource);
  if (!key) return false;
  return key.startsWith(
    `${TASK_ATTACHMENT_PREFIX}/${taskId}_${safePathSegment(targetKey)}_`
  );
}

export function resolveOwnAiChatAttachmentKey(
  fileSource: string,
  sessionId: string
): string | null {
  let url: URL;
  try {
    url = new URL(fileSource);
  } catch {
    return null;
  }

  const base = HYPERTASKS_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const expectedPrefix = `${base}/${AI_CHAT_ATTACHMENT_PREFIX}/${safePathSegment(sessionId)}/`;
  const normalized = `${url.origin}${url.pathname}`;
  if (!normalized.startsWith(expectedPrefix)) {
    return null;
  }
  const rest = normalized.slice(expectedPrefix.length);
  if (!rest || rest.includes("/")) {
    return null;
  }

  let fileSegment: string;
  try {
    fileSegment = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (fileSegment.includes("/") || fileSegment.includes("\\")) {
    return null;
  }

  return `${AI_CHAT_ATTACHMENT_PREFIX}/${safePathSegment(sessionId)}/${fileSegment}`;
}

export async function getHypertasksObjectSize(key: string): Promise<number | null> {
  try {
    const head = await getHypertasksS3Client()
      .headObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
      .promise();
    return head.ContentLength ?? null;
  } catch (error) {
    console.error("[getHypertasksObjectSize] headObject failed:", key, error);
    return null;
  }
}

export type HypertasksObjectState = "exists" | "missing" | "unknown";

export async function getHypertasksObjectState(
  key: string,
  signal?: AbortSignal
): Promise<HypertasksObjectState> {
  const head = getHypertasksS3Client().headObject({
    Bucket: HYPERTASKS_S3_BUCKET,
    Key: key,
  });
  const abortHead = () => head.abort();
  if (signal?.aborted) {
    head.abort();
  } else {
    signal?.addEventListener("abort", abortHead, { once: true });
  }
  const timer = setTimeout(() => head.abort(), MCP_ATTACHMENT_STORAGE_TIMEOUT_MS);
  try {
    await head.promise();
    return "exists";
  } catch (error) {
    const storageError = error as {
      code?: string;
      name?: string;
      statusCode?: number;
      $metadata?: { httpStatusCode?: number };
    };
    const status = storageError.statusCode ?? storageError.$metadata?.httpStatusCode;
    if (
      status === 404 ||
      storageError.code === "NoSuchKey" ||
      storageError.name === "NotFound"
    ) {
      return "missing";
    }
    if (!signal?.aborted) {
      console.error("[getHypertasksObjectState] headObject failed:", key, error);
    }
    return "unknown";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortHead);
  }
}

export async function deleteTaskAttachmentFromS3(
  fileSource: string
): Promise<boolean> {
  const key = parseHypertasksAttachmentKeyFromUrl(fileSource);
  if (!key) {
    return false;
  }

  return deleteTaskAttachmentObjectByKey(key);
}

export async function deleteTaskAttachmentObjectByKey(
  key: string,
  maxAttempts = 3
): Promise<boolean> {
  const s3 = getHypertasksS3Client();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await s3
        .deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
        .promise();
      return true;
    } catch (error) {
      console.error(
        "[deleteTaskAttachmentFromS3] deleteObject failed:",
        { key, attempt, maxAttempts },
        error
      );
    }
  }

  return false;
}
