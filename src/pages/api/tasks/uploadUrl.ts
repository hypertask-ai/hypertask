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
import { signUploadGrant } from "@/lib/storage/uploadGrant";
import { TASK_ATTACHMENT_PREFIX } from "@/lib/storage/uploadTaskAttachmentToS3";
import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";

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

// Duplicated from n8nUpload on purpose: that route's auth branch is pinned by a
// test that loads its transpiled source in isolation, and sharing the resolver
// would pull Prisma into that harness. Keep the two in sync (HTPR-5520).
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

export function parseRequestedFiles(body: unknown): {
  name: string;
  size: number;
  type: string | null;
}[] {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new UploadUrlRequestError("No files provided", 400);
  }
  if (files.length > DIRECT_UPLOAD_MAX_FILES) {
    throw new UploadUrlRequestError(
      `A maximum of ${DIRECT_UPLOAD_MAX_FILES} files may be uploaded at once`,
      400
    );
  }

  const parsed = files.map((entry) => {
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
    return {
      name,
      size,
      type: typeof file?.type === "string" ? file.type : null,
    };
  });

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // A signed PUT is a write capability on public attachment storage. Accept the
  // same two session sources as the buffered upload route (HTPR-5520).
  const session =
    verifySession(req.cookies[SESSION_COOKIE]) ??
    (await resolveBetterAuthSession(req));
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  try {
    const taskLinkRequested = req.body?.purpose === "task-attachment-link";
    if (req.body?.purpose !== undefined && !taskLinkRequested) {
      throw new UploadUrlRequestError("Invalid upload purpose", 400);
    }
    if (taskLinkRequested) {
      const { isFeatureEnabled } = await import("@/lib/flags");
      if (!(await isFeatureEnabled("htpr-5993-optimistic-task-uploads", session.id))) {
        throw new UploadUrlRequestError("Background task uploads are disabled", 403);
      }
    }
    const files = parseRequestedFiles(req.body);

    const uploads: DirectUploadTicket[] = await Promise.all(
      files.map(async (file) => {
        const contentType = directUploadContentType(file.type);
        const key = `${TASK_ATTACHMENT_PREFIX}/${Date.now()}_${randomUUID()}_${safeDirectUploadNameSegment(
          file.name
        )}`;
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
        userId: session.id,
        keys: uploads.map((upload) => upload.key),
        ...(taskLinkRequested
          ? {
              taskLinkFiles: uploads.map((upload) => ({
                key: upload.key,
                fileName: upload.fileName,
                contentType: upload.contentType,
              })),
            }
          : {}),
      },
      DIRECT_UPLOAD_URL_TTL_SECONDS
    );

    return res.status(200).json({ success: true, uploads, grant });
  } catch (error) {
    if (error instanceof UploadUrlRequestError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("[uploadUrl] Could not sign upload", error);
    return res.status(500).json({ error: "Could not prepare the upload" });
  }
}
