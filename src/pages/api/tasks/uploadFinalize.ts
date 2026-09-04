import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  DIRECT_UPLOAD_MAX_BATCH_BYTES,
  DIRECT_UPLOAD_MAX_FILES,
  DIRECT_UPLOAD_MAX_FILE_BYTES,
} from "@/lib/storage/directUpload";
import {
  signTaskAttachmentLinkReceipt,
  TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS,
  verifyTaskAttachmentLinkReceipt,
  verifyUploadGrant,
} from "@/lib/storage/uploadGrant";
import {
  discardTaskAttachment,
  linkTaskAttachment,
  TaskAttachmentLinkError,
} from "@/lib/storage/linkTaskAttachment";
import { broadcastTaskChange } from "@/lib/realtime/server";
import {
  getHypertasksS3Client,
  HYPERTASKS_S3_BUCKET,
} from "@/lib/storage/hypertasksS3";
import { TASK_ATTACHMENT_PREFIX } from "@/lib/storage/uploadTaskAttachmentToS3";
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Closes the direct-upload handshake (HTPR-5524 review).
 *
 * A signed PUT cannot carry a size limit: the AWS SDK refuses ContentLength in
 * a pre-signed URL, so the browser could upload a body far larger than the size
 * it declared. This route reads the stored object's real length and deletes
 * anything over the per-file ceiling, so the limit is enforced by the server
 * rather than trusted from the client.
 *
 * It also deletes objects the browser no longer wants, which is what keeps a
 * half-failed batch from leaving unreferenced files in public storage.
 */

const KEY_PATTERN = new RegExp(`^${TASK_ATTACHMENT_PREFIX}/[A-Za-z0-9._/-]+$`);

export function parseKeys(
  value: unknown,
  field: string,
  granted?: string[]
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > DIRECT_UPLOAD_MAX_FILES) {
    throw new Error(`Invalid "${field}"`);
  }
  return value.map((key) => {
    // The client may only name objects inside the attachments prefix, so this
    // route can never be used to read or delete anything else in the bucket.
    if (typeof key !== "string" || !KEY_PATTERN.test(key) || key.includes("..")) {
      throw new Error(`Invalid "${field}"`);
    }
    // Only keys this caller was just issued may be verified or deleted.
    if (granted && !granted.includes(key)) {
      throw new Error(`Invalid "${field}"`);
    }
    return key;
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session =
    verifySession(req.cookies[SESSION_COOKIE]) ??
    (await resolveBetterAuthSession(req));
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  if (req.body?.action === "link-task-attachment") {
    let enabled: boolean;
    try {
      const { isFeatureEnabled } = await import("@/lib/flags");
      enabled = await isFeatureEnabled(
        "htpr-5993-optimistic-task-uploads",
        session.id,
      );
    } catch (error) {
      console.error("[uploadFinalize] Could not evaluate upload feature flag", error);
      return res.status(500).json({ error: "Could not link attachment" });
    }
    if (!enabled) {
      return res.status(403).json({ error: "Background task uploads are disabled" });
    }
    const taskId = Number(req.body?.taskId);
    const receipt = verifyTaskAttachmentLinkReceipt(req.body?.receipt);
    if (!Number.isSafeInteger(taskId) || taskId <= 0 || !receipt) {
      return res.status(400).json({ error: "Invalid attachment link request" });
    }
    if (receipt.userId !== session.id) {
      return res.status(403).json({ error: "This upload cannot be linked" });
    }
    try {
      const attachment = await linkTaskAttachment(taskId, session.id, receipt);
      try {
        await broadcastTaskChange(taskId, { originUserId: session.id });
      } catch (error) {
        console.warn("[uploadFinalize] task realtime delivery failed", error);
      }
      return res.status(200).json({ success: true, attachment });
    } catch (error) {
      if (error instanceof TaskAttachmentLinkError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[uploadFinalize] Could not link attachment", error);
      return res.status(500).json({ error: "Could not link attachment" });
    }
  }

  if (req.body?.action === "discard-task-attachment") {
    const receipt = verifyTaskAttachmentLinkReceipt(req.body?.receipt);
    if (
      !receipt ||
      !KEY_PATTERN.test(receipt.key) ||
      receipt.key.includes("..")
    ) {
      return res.status(400).json({ error: "Invalid attachment discard request" });
    }
    if (receipt.userId !== session.id) {
      return res.status(403).json({ error: "This upload cannot be discarded" });
    }
    try {
      const discarded = await discardTaskAttachment(session.id, receipt);
      return res.status(200).json({ success: true, discarded });
    } catch (error) {
      if (error instanceof TaskAttachmentLinkError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("[uploadFinalize] Could not discard attachment", error);
      return res.status(500).json({ error: "Could not discard attachment" });
    }
  }

  const grant = verifyUploadGrant((req.body as { grant?: unknown })?.grant);
  if (!grant || grant.userId !== session.id) {
    return res
      .status(403)
      .json({ error: "This upload cannot be finalized", code: "GRANT_INVALID" });
  }

  const issueTaskLinkReceipts = req.body?.issueTaskLinkReceipts === true;
  if (issueTaskLinkReceipts && !grant.taskLinkFiles) {
    return res.status(403).json({ error: "This upload cannot be linked to a task" });
  }

  let keep: string[];
  let discard: string[];
  try {
    keep = parseKeys((req.body as { keep?: unknown })?.keep, "keep", grant.keys);
    discard = parseKeys(
      (req.body as { discard?: unknown })?.discard,
      "discard",
      grant.keys
    );
  } catch (error) {
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : "Invalid request" });
  }

  const s3 = getHypertasksS3Client();
  const remove = async (key: string) => {
    try {
      await s3.deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key }).promise();
    } catch {
      // Best effort: a stray object is not worth failing the upload over.
    }
  };

  await Promise.all(discard.map(remove));

  // The signed PUT carries no size condition, so the stored length is the only
  // trustworthy number. Both the per-file and the whole-batch ceiling are
  // checked against it, never against what the client declared.
  const sizes = await Promise.all(
    keep.map(async (key) => {
      try {
        const head = await s3
          .headObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
          .promise();
        return head.ContentLength ?? 0;
      } catch {
        // A key that cannot be read cannot be vouched for either.
        return null;
      }
    })
  );

  const unreadable = keep.filter((_key, index) => sizes[index] === null);
  if (unreadable.length > 0) {
    return res
      .status(409)
      .json({ error: "That upload could not be verified", code: "UPLOAD_UNVERIFIED" });
  }

  const verified = sizes as number[];
  const total = verified.reduce((sum, size) => sum + size, 0);
  const oversized =
    total > DIRECT_UPLOAD_MAX_BATCH_BYTES
      ? keep
      : keep.filter((_key, index) => verified[index] > DIRECT_UPLOAD_MAX_FILE_BYTES);

  if (oversized.length > 0) {
    await Promise.all(oversized.map(remove));
  }

  if (oversized.length > 0) {
    return res.status(413).json({
      error: "That upload is larger than the limit and was removed.",
      code: "UPLOAD_TOO_LARGE",
    });
  }

  const taskLinkReceipts = issueTaskLinkReceipts
    ? keep.map((key, index) => {
        const file = grant.taskLinkFiles?.find((candidate) => candidate.key === key);
        if (!file) return null;
        return signTaskAttachmentLinkReceipt(
          {
            userId: session.id,
            key,
            fileName: file.fileName,
            contentType: file.contentType,
            fileSize: verified[index],
          },
          TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS,
        );
      })
    : undefined;
  if (taskLinkReceipts?.some((receipt) => receipt === null)) {
    return res.status(400).json({ error: "Upload metadata is incomplete" });
  }

  return res.status(200).json({
    success: true,
    ...(taskLinkReceipts ? { taskLinkReceipts } : {}),
  });
}

// Duplicated from n8nUpload on purpose; see the note in uploadUrl.ts (HTPR-5520).
async function resolveBetterAuthSession(
  req: NextApiRequest
): Promise<{ id: number } | null> {
  const { getSessionUser } = await import("@/lib/auth/getSessionUser");
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join("; "));
  }
  const session = await getSessionUser(headers);
  return session ? { id: session.userId } : null;
}
