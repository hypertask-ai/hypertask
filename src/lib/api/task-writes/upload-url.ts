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
      const files = parseRequestedFiles(body);

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

      const grant = signUploadGrant(
        {
          userId: session.userId,
          keys: uploads.map((upload) => upload.key),
          ...(taskLinkRequested
            ? {
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
  const signed = verifySession(request.cookies ? request.cookies[SESSION_COOKIE] : parseCookies(request.headers.get("cookie") ?? "").get(SESSION_COOKIE));
  const session = signed
    ? { userId: signed.id, source: "legacy" as const, needsBridge: true as const }
    : await getSessionUser(request.headers);
  if (!session) return NextResponse.json({ error: "Unauthorized", code: "SESSION_REQUIRED" }, { status: 401 });
  return route(request, session);
};
