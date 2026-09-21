import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  MCP_ATTACHMENT_MAX_BATCH_BYTES,
  MCP_ATTACHMENT_MAX_BYTES,
  MCP_ATTACHMENT_MAX_FILES,
} from "@/lib/mcp/attachments/constants";
import {
  formatUploadBytes,
  UPLOAD_MAX_FILE_BYTES,
  UPLOAD_MAX_REQUEST_BYTES,
} from "@/lib/storage/uploadLimits";
import {
  parseHypertasksAttachmentKeyFromUrl,
  uploadTaskAttachmentToS3,
} from "@/lib/storage/uploadTaskAttachmentToS3";
import {
  signTaskAttachmentLinkReceipt,
  TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS,
} from "@/lib/storage/uploadGrant";
import type { NextApiRequest, NextApiResponse } from "next";
import getRawBody from "raw-body";

export const config = {
  api: {
    bodyParser: false,
  },
};

// Leave room for multipart headers and boundaries above the decoded batch cap.
const LEGACY_UPLOAD_MAX_BATCH_REQUEST_BYTES =
  MCP_ATTACHMENT_MAX_BATCH_BYTES + 1024 * 1024;

// Vercel rejects a serverless request body above 4.5 MB before this handler
// runs, so any larger cap can never take effect and only turns an explainable
// error into an opaque platform 413 (HTPR-5516). Stay at the platform ceiling
// and report the same limit the browser enforces.
export const LEGACY_UPLOAD_MAX_REQUEST_BYTES = Math.min(
  LEGACY_UPLOAD_MAX_BATCH_REQUEST_BYTES,
  UPLOAD_MAX_REQUEST_BYTES
);

type UploadFile = {
  buffer: Buffer;
  fileName: string;
  fileType: string | null;
};

export class UploadRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

function parseBoundary(contentType: string): string | null {
  if (!/^multipart\/form-data(?:\s*;|$)/i.test(contentType)) return null;
  const match = contentType.match(
    /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i
  );
  const boundary = match?.[1] ?? match?.[2];
  // RFC 2046 recommends no more than 70 characters. Bounding it also keeps the
  // delimiter search predictable for attacker-controlled request headers.
  return boundary && boundary.length <= 70 ? boundary : null;
}

async function readMultipartBody(req: NextApiRequest): Promise<Buffer> {
  const contentLengthHeader = req.headers["content-length"];
  const contentLength =
    typeof contentLengthHeader === "string"
      ? Number(contentLengthHeader)
      : undefined;

  if (
    contentLength !== undefined &&
    (!Number.isSafeInteger(contentLength) || contentLength < 0)
  ) {
    throw new UploadRequestError("Invalid Content-Length", 400);
  }
  if (
    contentLength !== undefined &&
    contentLength > LEGACY_UPLOAD_MAX_REQUEST_BYTES
  ) {
    throw new UploadRequestError("Upload request is too large", 413);
  }

  try {
    return await getRawBody(req, {
      length: contentLength,
      limit: LEGACY_UPLOAD_MAX_REQUEST_BYTES,
    });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) {
      throw new UploadRequestError("Upload request is too large", 413);
    }
    if (status === 400) {
      throw new UploadRequestError("Malformed upload request", 400);
    }
    throw error;
  }
}

// Falls back to the app-wide session resolver, which also honours the rolling
// Better Auth session (HTPR-5520). Returns null when neither source is valid.
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // This endpoint writes directly to public attachment storage. Authenticate
  // before reading a potentially large body or touching storage.
  //
  // Accept BOTH session sources (HTPR-5520). Better Auth sessions roll forward
  // on each day of use, while ht_session is minted once at login with a fixed
  // expiry and never refreshed. A user active past that lifetime keeps a valid
  // Better Auth session but loses ht_session, so a legacy-only check made this
  // the one route that 401s for an otherwise logged-in user: attachments failed
  // in comments and descriptions while text-only comments still posted.
  //
  // getSessionUser is imported lazily so the legacy path stays free of the
  // Better Auth and Prisma module graph.
  const session =
    verifySession(req.cookies[SESSION_COOKIE]) ??
    (await resolveBetterAuthSession(req));
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  try {
    const taskLinkRequested =
      req.headers["x-upload-purpose"] === "task-attachment-link";
    if (req.headers["x-upload-purpose"] !== undefined && !taskLinkRequested) {
      throw new UploadRequestError("Invalid upload purpose", 400);
    }
    if (taskLinkRequested) {
      const { isFeatureEnabled } = await import("@/lib/flags");
      if (!(await isFeatureEnabled("htpr-5993-optimistic-task-uploads", session.id))) {
        throw new UploadRequestError("Background task uploads are disabled", 403);
      }
    }
    const contentType = req.headers["content-type"];
    if (typeof contentType !== "string") {
      throw new UploadRequestError("Invalid content type", 400);
    }

    const boundary = parseBoundary(contentType);
    if (!boundary) {
      throw new UploadRequestError("Invalid multipart boundary", 400);
    }

    const rawData = await readMultipartBody(req);
    const files = extractFilesFromMultipart(rawData, boundary);
    if (files.length === 0) {
      throw new UploadRequestError("No files provided", 400);
    }

    const fileUrls = await uploadAttachmentsToS3(files);
    const taskLinkReceipts = taskLinkRequested
      ? fileUrls.map((fileUrl, index) => {
          const key = parseHypertasksAttachmentKeyFromUrl(fileUrl);
          if (!key) throw new Error("Uploaded attachment key is invalid");
          return signTaskAttachmentLinkReceipt(
            {
              userId: session.id,
              key,
              fileName: files[index].fileName,
              contentType:
                files[index].fileType || "application/octet-stream",
              fileSize: files[index].buffer.length,
            },
            TASK_ATTACHMENT_LINK_RECEIPT_TTL_SECONDS
          );
        })
      : undefined;
    return res.status(200).json({
      success: true,
      fileUrls,
      ...(taskLinkReceipts ? { taskLinkReceipts } : {}),
    });
  } catch (error) {
    if (error instanceof UploadRequestError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("[n8nUpload] Upload failed", error);
    return res.status(500).json({ error: "Error uploading files" });
  }
}

export function extractFilesFromMultipart(
  buffer: Buffer,
  boundary: string
): UploadFile[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerTerminator = Buffer.from("\r\n\r\n");
  const boundaryIndices: number[] = [];
  let searchPos = 0;

  while (searchPos < buffer.length) {
    const index = buffer.indexOf(delimiter, searchPos);
    if (index === -1) break;
    // A multipart delimiter is either the first bytes or follows CRLF. Do not
    // split a binary file merely because its bytes contain the boundary text.
    if (
      index === 0 ||
      (index >= 2 && buffer[index - 2] === 0x0d && buffer[index - 1] === 0x0a)
    ) {
      const suffixStart = index + delimiter.length;
      const isPartDelimiter =
        buffer[suffixStart] === 0x0d && buffer[suffixStart + 1] === 0x0a;
      const isClosingDelimiter =
        buffer[suffixStart] === 0x2d && buffer[suffixStart + 1] === 0x2d;
      if (isPartDelimiter || isClosingDelimiter) {
        boundaryIndices.push(index);
      }
    }
    searchPos = index + delimiter.length;
  }

  const files: UploadFile[] = [];
  let totalFileBytes = 0;
  for (let i = 0; i < boundaryIndices.length - 1; i += 1) {
    const partStart = boundaryIndices[i] + delimiter.length;
    const partEnd = boundaryIndices[i + 1];
    const part = buffer.subarray(partStart, partEnd);
    const headerEndIndex = part.indexOf(headerTerminator);
    if (headerEndIndex === -1 || headerEndIndex > 16 * 1024) continue;

    const headerText = part.subarray(0, headerEndIndex).toString("utf8");
    const filenameMatch = headerText.match(
      /Content-Disposition:[^\r\n]*\bfilename="([^"]+)"/i
    );
    if (!filenameMatch) continue;
    if (files.length >= MCP_ATTACHMENT_MAX_FILES) {
      throw new UploadRequestError(
        `A maximum of ${MCP_ATTACHMENT_MAX_FILES} files may be uploaded at once`,
        413
      );
    }

    const fileName = filenameMatch[1];
    if (Buffer.byteLength(fileName, "utf8") > 255) {
      throw new UploadRequestError("File name exceeds the 255-byte limit", 400);
    }
    const contentTypeMatch = headerText.match(/(?:^|\r\n)Content-Type:\s*([^\r\n]+)/i);
    const extension = fileName.split(".").pop()?.toLowerCase();
    const fileType =
      contentTypeMatch?.[1].trim() ||
      (extension ? getMimeTypeFromExtension(extension) : null);
    const fileStart = headerEndIndex + headerTerminator.length;
    // The CRLF immediately before the next boundary belongs to multipart, not
    // to the uploaded file.
    const fileEnd = Math.max(fileStart, part.length - 2);
    const fileBuffer = part.subarray(fileStart, fileEnd);

    // The browser-facing cap: anything above this cannot reach production
    // anyway, so report it in the same words the client shows (HTPR-5516).
    if (fileBuffer.length > UPLOAD_MAX_FILE_BYTES) {
      throw new UploadRequestError(
        `File "${fileName}" exceeds the ${formatUploadBytes(UPLOAD_MAX_FILE_BYTES)} limit`,
        413
      );
    }
    if (fileBuffer.length > MCP_ATTACHMENT_MAX_BYTES) {
      throw new UploadRequestError(
        `File "${fileName}" exceeds the ${MCP_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB limit`,
        413
      );
    }
    totalFileBytes += fileBuffer.length;
    if (totalFileBytes > UPLOAD_MAX_REQUEST_BYTES) {
      throw new UploadRequestError(
        `Combined file size exceeds the ${formatUploadBytes(UPLOAD_MAX_REQUEST_BYTES)} limit`,
        413
      );
    }
    if (totalFileBytes > MCP_ATTACHMENT_MAX_BATCH_BYTES) {
      throw new UploadRequestError("Combined file size exceeds the 30 MB limit", 413);
    }

    files.push({ buffer: fileBuffer, fileName, fileType });
  }

  return files;
}

export async function uploadAttachmentsToS3(files: UploadFile[]) {
  return Promise.all(
    files.map((file) =>
      uploadSingleAttachment(file.buffer, file.fileName, file.fileType)
    )
  );
}

export async function uploadSingleAttachment(
  buffer: Buffer,
  fileName: string,
  fileType: string | null
) {
  return uploadTaskAttachmentToS3(
    buffer,
    fileName,
    fileType || "application/octet-stream"
  );
}

function getMimeTypeFromExtension(extension: string): string {
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    zip: "application/zip",
    apk: "application/vnd.android.package-archive",
    rar: "application/x-rar-compressed",
    svg: "image/svg+xml",
  };

  return mimeTypes[extension] || "application/octet-stream";
}
