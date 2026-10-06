import { NextResponse } from "next/server";
import { z } from "zod";
import { parseCookies } from "better-auth/cookies";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  DIRECT_UPLOAD_MAX_FILES,
  DIRECT_UPLOAD_URL_TTL_SECONDS,
  directUploadContentType,
  getDirectUploadSizeError,
  safeDirectUploadNameSegment,
  type DirectUploadTicket,
} from "@/lib/storage/directUpload";
import {
  getHypertasksPresignClient,
  getHypertasksStoragePublicUrl,
  HYPERTASKS_S3_BUCKET,
} from "@/lib/storage/hypertasksS3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  HEIC_PREVIEW_CONTENT_TYPE,
  heicPreviewKey,
} from "@/lib/media/heicPreview";
import { signUploadGrant } from "@/lib/storage/uploadGrant";
import { TASK_ATTACHMENT_PREFIX } from "@/lib/storage/uploadTaskAttachmentToS3";
import { randomUUID } from "node:crypto";

/**
 * Mints short-lived signed PUT URLs so the browser can upload attachments
 * straight to storage (HTPR-5524).
 *
 * Only this small JSON handshake crosses the Vercel function, so the platform's
 * 4.5 MB request-body ceiling no longer caps attachment size. The buffered
 * `/api/tasks/n8nUpload` route stays as the fallback for small files.
 *
 * The client never chooses the object key or the bucket: it sends a name, a
 * size and a type, and the server decides where the bytes land and what
 * Content-Type the signature is bound to.
 */

type RequestedFile = {
  name: unknown;
  size: unknown;
  type?: unknown;
  previewOfIndex?: unknown;
};

export type ParsedRequestFile = {
  name: string;
  size: number;
  type: string | null;
  /** Set when this entry is the JPEG copy of an earlier entry (HTPR-6264). */
  previewOfIndex?: number;
};

class UploadUrlRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "UploadUrlRequestError";
  }
}

export function parseRequestedFiles(body: unknown): ParsedRequestFile[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new UploadUrlRequestError("No files provided", 400);
  }
  // A HEIC contributes two entries (HTPR-6264), so the hard ceiling on the
  // array is twice the ceiling on files the user picked. The user-facing count
  // is checked below, once the preview entries can be told apart.
  if (files.length > DIRECT_UPLOAD_MAX_FILES * 2) {
    throw new UploadUrlRequestError(
      `A maximum of ${DIRECT_UPLOAD_MAX_FILES} files may be uploaded at once`,
      400
    );
  }

  const parsed: ParsedRequestFile[] = files.map((entry, index) => {
    const file = entry as RequestedFile;
    const name = typeof file?.name === "string" ? file.name.trim() : "";
    if (!name) {
      throw new UploadUrlRequestError("Each file needs a name", 400);
    }
    if (Buffer.byteLength(name, "utf8") > 255) {
      throw new UploadUrlRequestError("File name exceeds the 255-byte limit", 400);
    }
    const size = file?.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new UploadUrlRequestError(`Invalid size for "${name}"`, 400);
    }

    // A preview's key is derived from its original's, so the reference has to
    // point backwards at a real entry that is not itself a preview. Anything
    // else and the key could not be built, or could be aimed somewhere the
    // caller was never issued.
    const previewOf = file?.previewOfIndex;
    if (previewOf !== undefined) {
      if (
        typeof previewOf !== "number" ||
        !Number.isInteger(previewOf) ||
        previewOf < 0 ||
        previewOf >= index
      ) {
        throw new UploadUrlRequestError(
          `Invalid preview reference for "${name}"`,
          400
        );
      }
      const target = files[previewOf] as RequestedFile;
      if (target?.previewOfIndex !== undefined) {
        throw new UploadUrlRequestError(
          `A preview cannot be a preview of a preview ("${name}")`,
          400
        );
      }
      return {
        name,
        size,
        type: typeof file?.type === "string" ? file.type : null,
        previewOfIndex: previewOf,
      };
    }

    return {
      name,
      size,
      type: typeof file?.type === "string" ? file.type : null,
    };
  });

  // At most one preview per original: two entries claiming the same parent
  // would be signed for the same derived key and the second would overwrite
  // the first.
  const claimed = new Set<number>();
  for (const file of parsed) {
    if (file.previewOfIndex === undefined) continue;
    if (claimed.has(file.previewOfIndex)) {
      throw new UploadUrlRequestError(
        `Duplicate preview for "${parsed[file.previewOfIndex].name}"`,
        400
      );
    }
    claimed.add(file.previewOfIndex);
  }

  if (parsed.filter((file) => file.previewOfIndex === undefined).length >
    DIRECT_UPLOAD_MAX_FILES) {
    throw new UploadUrlRequestError(
      `A maximum of ${DIRECT_UPLOAD_MAX_FILES} files may be uploaded at once`,
      400
    );
  }

  const sizeError = getDirectUploadSizeError(parsed);
  if (sizeError) {
    throw new UploadUrlRequestError(sizeError, 413);
  }

  return parsed;
}

/**
 * Signs a PUT that is bound to one key, one content type and one exact byte
 * length. Content-length is part of the signature, so storage itself rejects a
 * body of any other size and the declared size stops being a claim we trust.
 *
 * The SDK v2 presigner cannot do this ("ContentLength is not supported in
 * pre-signed URLs"), which is why the v3 presigner is used here.
 * /api/tasks/uploadFinalize still verifies the stored length as a second layer.
 */
export async function signUpload(
  key: string,
  contentType: string,
  size: number
): Promise<string> {
  return getSignedUrl(
    getHypertasksPresignClient(),
    new PutObjectCommand({
      Bucket: HYPERTASKS_S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    {
      expiresIn: DIRECT_UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-length", "content-type"]),
    }
  );
}

const route = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Invalid request",
  allowNullBody: true,
  operation: async (body, session) => {
    try {
      const taskLinkRequested = body?.purpose === "task-attachment-link";
      if (body?.purpose !== undefined && !taskLinkRequested) {
        throw new UploadUrlRequestError("Invalid upload purpose", 400);
      }
      if (taskLinkRequested) {
        const { isFeatureEnabled } = await import("@/lib/flags");
        if (!(await isFeatureEnabled("htpr-5993-optimistic-task-uploads", session.userId))) {
          throw new UploadUrlRequestError("Background task uploads are disabled", 403);
        }
      }
      const files = parseRequestedFiles(body);

      // Keys first, then signatures, because a preview's key is its original's
      // with a suffix (HTPR-6264) and so cannot be minted until that one exists.
      // The client never picks a key here either: it only says which entry a
      // preview belongs to, and the derivation is the server's.
      const keys: string[] = [];
      const contentTypes: string[] = [];
      files.forEach((file, index) => {
        if (file.previewOfIndex !== undefined) {
          keys[index] = heicPreviewKey(keys[file.previewOfIndex]);
          contentTypes[index] = HEIC_PREVIEW_CONTENT_TYPE;
          return;
        }
        keys[index] = `${TASK_ATTACHMENT_PREFIX}/${Date.now()}_${randomUUID()}_${safeDirectUploadNameSegment(
          file.name
        )}`;
        contentTypes[index] = directUploadContentType(file.type);
      });

      const uploads: DirectUploadTicket[] = await Promise.all(
        files.map(async (file, index) => {
          const key = keys[index];
          const contentType = contentTypes[index];
          const uploadUrl = await signUpload(key, contentType, file.size);
          return {
            uploadUrl,
            key,
            fileUrl: getHypertasksStoragePublicUrl(key),
            contentType,
            fileName: file.name,
          };
        })
      );

      // The grant names exactly these keys for exactly this user, so finalizing
      // or discarding them is a capability rather than a bucket-wide permission.
      const grant = signUploadGrant(
        {
          userId: session.userId,
          keys: uploads.map((upload) => upload.key),
          ...(taskLinkRequested
            ? {
                // A preview is storage, not an attachment: it must never become a
                // row of its own, so it is not offered as a linkable file
                // (HTPR-6264).
                taskLinkFiles: uploads
                  .filter((_, index) => files[index].previewOfIndex === undefined)
                  .map((upload) => ({
                    key: upload.key,
                    fileName: upload.fileName,
                    contentType: upload.contentType,
                  })),
              }
            : {}),
        },
        DIRECT_UPLOAD_URL_TTL_SECONDS
      );

      return NextResponse.json({ success: true, uploads, grant }, { status: 200 });
    } catch (error) {
      if (error instanceof UploadUrlRequestError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("[uploadUrl] Could not sign upload", error);
      return NextResponse.json({ error: "Could not prepare the upload" }, { status: 500 });
    }
  },
});

export const POST: TaskWriteRoute = async (request) => {
  // Preserve uploads' signed-cookie-first auth and their SESSION_REQUIRED body.
  const signed = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  const session = signed
    ? { userId: signed.id, source: "legacy" as const, needsBridge: true as const }
    : await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
