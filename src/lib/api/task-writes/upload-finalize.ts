import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCookies } from "better-auth/cookies";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { isHeicPreviewUrl } from "@/lib/media/heicPreview";
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


const KEY_PATTERN = new RegExp(`^${TASK_ATTACHMENT_PREFIX}/[A-Za-z0-9._/-]+$`);

export function parseKeys(
  value: unknown,
  field: string,
  granted?: string[]
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > DIRECT_UPLOAD_MAX_FILES * 2) {
    throw new Error(`Invalid "${field}"`);
  }
  return value.map((key) => {
    if (typeof key !== "string" || !KEY_PATTERN.test(key) || key.includes("..")) {
      throw new Error(`Invalid "${field}"`);
    }
    if (granted && !granted.includes(key)) {
      throw new Error(`Invalid "${field}"`);
    }
    return key;
  });
}

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    if (body?.action === "link-task-attachment") {
      const taskId = Number(body?.taskId);
      const receipt = verifyTaskAttachmentLinkReceipt(body?.receipt);
      if (!Number.isSafeInteger(taskId) || taskId <= 0 || !receipt) {
        return NextResponse.json({ error: "Invalid attachment link request" }, { status: 400 });
      }
      if (receipt.userId !== session.userId) {
        return NextResponse.json({ error: "This upload cannot be linked" }, { status: 403 });
      }
      try {
        const attachment = await linkTaskAttachment(taskId, session.userId, receipt);
        try {
          await broadcastTaskChange(taskId, { originUserId: session.userId });
        } catch (error) {
          console.warn("[uploadFinalize] task realtime delivery failed", error);
        }
        return NextResponse.json({ success: true, attachment }, { status: 200 });
      } catch (error) {
        if (error instanceof TaskAttachmentLinkError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[uploadFinalize] Could not link attachment", error);
        return NextResponse.json({ error: "Could not link attachment" }, { status: 500 });
      }
    }

    if (body?.action === "discard-task-attachment") {
      const receipt = verifyTaskAttachmentLinkReceipt(body?.receipt);
      if (
        !receipt ||
        !KEY_PATTERN.test(receipt.key) ||
        receipt.key.includes("..")
      ) {
        return NextResponse.json({ error: "Invalid attachment discard request" }, { status: 400 });
      }
      if (receipt.userId !== session.userId) {
        return NextResponse.json({ error: "This upload cannot be discarded" }, { status: 403 });
      }
      try {
        const discarded = await discardTaskAttachment(session.userId, receipt);
        return NextResponse.json({ success: true, discarded }, { status: 200 });
      } catch (error) {
        if (error instanceof TaskAttachmentLinkError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("[uploadFinalize] Could not discard attachment", error);
        return NextResponse.json({ error: "Could not discard attachment" }, { status: 500 });
      }
    }

    const grant = verifyUploadGrant((body as { grant?: unknown })?.grant);
    if (!grant || grant.userId !== session.userId) {
      return NextResponse.json({ error: "This upload cannot be finalized", code: "GRANT_INVALID" }, { status: 403 });
    }

    const issueTaskLinkReceipts = body?.issueTaskLinkReceipts === true;
    if (issueTaskLinkReceipts && !grant.taskLinkFiles) {
      return NextResponse.json({ error: "This upload cannot be linked to a task" }, { status: 403 });
    }

    let keep: string[];
    let discard: string[];
    try {
      keep = parseKeys((body as { keep?: unknown })?.keep, "keep", grant.keys);
      discard = parseKeys(
        (body as { discard?: unknown })?.discard,
        "discard",
        grant.keys
      );
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
    }

    const s3 = getHypertasksS3Client();
    const remove = async (key: string) => {
      try {
        await s3.deleteObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key }).promise();
      } catch {
      }
    };

    await Promise.all(discard.map(remove));

    const sizes = await Promise.all(
      keep.map(async (key) => {
        try {
          const head = await s3
            .headObject({ Bucket: HYPERTASKS_S3_BUCKET, Key: key })
            .promise();
          return head.ContentLength ?? 0;
        } catch {
          return null;
        }
      })
    );

    const unreadable = keep.filter((_key, index) => sizes[index] === null);
    if (unreadable.length > 0) {
      return NextResponse.json({ error: "That upload could not be verified", code: "UPLOAD_UNVERIFIED" }, { status: 409 });
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
      return NextResponse.json({
        error: "That upload is larger than the limit and was removed.",
        code: "UPLOAD_TOO_LARGE",
      }, { status: 413 });
    }

    const taskLinkReceipts = issueTaskLinkReceipts
      ? keep
          .map((key, index) => ({ key, index }))
          .filter(({ key }) => !isHeicPreviewUrl(key))
          .map(({ key, index }) => {
            const file = grant.taskLinkFiles?.find(
              (candidate) => candidate.key === key,
            );
            if (!file) return null;
            return signTaskAttachmentLinkReceipt(
              {
                userId: session.userId,
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
      return NextResponse.json({ error: "Upload metadata is incomplete" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      ...(taskLinkReceipts ? { taskLinkReceipts } : {}),
    }, { status: 200 });
  },
});

export const POST: TaskWriteRoute = async (request) => {
  const signed = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  const session = signed
    ? { userId: signed.id, source: "legacy" as const, needsBridge: true as const }
    : await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
