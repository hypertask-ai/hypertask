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

//Right so added a new route for a-chat attachments. The upload function could have been reused but I will admit, I am lazy. 
//Deletion function works for both. A little vibe code here and there. 

function safeFileNameSegment(fileName: string): string {
  return fileName.replace(/\s+/g, "_").replace(/[/\\]/g, "_");
}

function safeDeterministicFileNameSegment(fileName: string): string {
  const digest = createHash("sha256").update(fileName).digest("hex").slice(0, 16);
  // Keep the object key URL-safe without percent escapes: the public URL helper
  // concatenates keys verbatim, while S3 would decode %XX in an HTTP path. The
  // digest preserves the exact original identity after replacement/truncation.
  const display = fileName
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 200);
  return `${display}_${digest}`;
}

function safePathSegment(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

/**
 * Upload task attachment bytes to Hypertasks S3 (same bucket/key style as n8nUpload).
 * Returns the public HTTPS URL used as Attachment.fileSource.
 */
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

/**
 * Stable per-target key for retry-safe MCP batches. The key is known before the
 * upload starts, and retrying the same file overwrites rather than duplicates an
 * object when an S3 response is lost.
 */
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

/**
 * Upload AI Chat attachment bytes under {@link AI_CHAT_ATTACHMENT_PREFIX} (per-session subfolder).
 * Returns the public HTTPS URL used as Attachment.fileSource.
 */
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

/**
 * Returns the S3 object key for Hypertasks-managed attachment URLs (task or AI chat uploads),
 * or null if the URL is not our bucket / path.
 */
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

/** True for retry-safe MCP objects belonging to one task attachment target. */
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

/**
 * Resolves an AI chat attachment URL that THIS session already uploaded, or null.
 *
 * Editor attachments reach the persist route as a URL, not as bytes: the file went to
 * storage when it was pasted, and the browser cannot read it back (the host serves no CORS
 * header, see HTPR-4735). So the route has to trust a URL, and this is the check that makes
 * that safe.
 *
 * The rule is deliberately narrow: our own public base URL, the AI chat prefix, and this
 * session's own folder. Nothing else. Accepting any managed key would be a real escalation,
 * not a cosmetic one, because deleting a chat session deletes the underlying object for
 * every attachment row it holds. A user could otherwise paste someone else's task
 * attachment URL into their own chat and delete the file by deleting that chat.
 */
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
  // A single segment only: "…/<session>/1_a.png" is ours, "…/<session>/../other/x" is not.
  const rest = normalized.slice(expectedPrefix.length);
  if (!rest || rest.includes("/")) {
    return null;
  }

  // R2 and S3 key off the decoded path, while the URL carries it percent-encoded, so a file
  // named "resume\u0301.png" would miss its own object without this.
  let fileSegment: string;
  try {
    fileSegment = decodeURIComponent(rest);
  } catch {
    return null;
  }
  // url.pathname leaves %2F encoded, so the segment check above cannot see a separator that
  // only appears once decoded. Re-check rather than trust the pre-decode shape.
  if (fileSegment.includes("/") || fileSegment.includes("\\")) {
    return null;
  }

  return `${AI_CHAT_ATTACHMENT_PREFIX}/${safePathSegment(sessionId)}/${fileSegment}`;
}

/**
 * Size in bytes of a stored object, or null when it cannot be read.
 *
 * Best-effort only: callers must already have authorised the key. A HEAD that fails for a
 * transient or permission reason must not be read as "this attachment is not allowed",
 * or a storage blip would silently drop the user's message.
 */
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

/** Distinguish a confirmed missing deterministic object from a transient HEAD failure. */
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

/**
 * Deletes an object from the Hypertasks attachments bucket. Best-effort: logs and returns false on failure.
 */
export async function deleteTaskAttachmentFromS3(
  fileSource: string
): Promise<boolean> {
  const key = parseHypertasksAttachmentKeyFromUrl(fileSource);
  if (!key) {
    return false;
  }

  return deleteTaskAttachmentObjectByKey(key);
}

/** Delete a known attachment key with bounded retries so rollback is observable. */
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
