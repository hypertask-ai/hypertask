import axios from "axios";

import {
  isHeicByMetadata,
  planUploadFiles,
  type UploadPlan,
} from "@/lib/media/heicToJpeg";
import { isHeicPreviewUrl } from "@/lib/media/heicPreview";

import {
  directUploadContentType,
  DIRECT_UPLOAD_MAX_FILE_BYTES,
  getDirectUploadSizeError,
  type DirectUploadTicket,
} from "./directUpload";
import {
  getUploadSizeError,
  UPLOAD_TOO_LARGE_MESSAGE,
  UploadTooLargeError,
} from "./uploadLimits";

type UploadApiResponse = {
  success?: boolean;
  fileUrls?: string[];
  taskLinkReceipts?: string[];
};

type UploadResult = {
  urls: string[];
  taskLinkReceipts: string[];
};

export type TaskAttachmentUploadReceipt = {
  url: string;
  receipt: string;
};

type UploadUrlApiResponse = {
  success?: boolean;
  uploads?: DirectUploadTicket[];
  /** Signed proof of which keys this caller was issued. */
  grant?: string;
};

// Vercel rejects an oversized body at the edge, so that 413 has no JSON body to
// read. Turn any 413 into a message the UI can show (HTPR-5516).
function throwReadableUploadError(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.status === 413) {
    const serverMessage = (
      error.response.data as { error?: string } | undefined
    )?.error;
    throw new UploadTooLargeError(
      typeof serverMessage === "string" && serverMessage
        ? serverMessage
        : UPLOAD_TOO_LARGE_MESSAGE
    );
  }
  throw error;
}

/**
 * One object to send to storage.
 *
 * A batch is the files the user picked, each optionally followed by the JPEG
 * copy of it that HTPR-6264 generates for a HEIC. `previewOfIndex` is the only
 * thing that tells the two apart, and it points backwards at the entry the
 * preview belongs to so the server can derive its key.
 */
type BatchEntry = {
  file: File;
  /** Set only on a generated preview; the index of the file it is a copy of. */
  previewOfIndex?: number;
};

/**
 * Flattens the upload plans into the batch the handshake sends.
 *
 * Order matters twice: `previewOfIndex` refers to a position in this array, and
 * the caller reads results back out of it by position to return only the URLs
 * of the files the user actually picked.
 */
/**
 * Whether a generated copy is worth the second object.
 *
 * Two ways it is not. It may not fit: JPEG is a worse compressor than HEIC, so
 * a photo close to the per-file ceiling can decode to something over it, and
 * sending that would fail the size check for the whole batch and cost the user
 * the photo itself for the sake of a thumbnail.
 *
 * Or it may be unreachable. The decoder identifies a HEIC by its bytes, but
 * render sites resolve the copy from the attachment's stored type and name, so
 * a photo that arrives with no usable MIME type AND no extension is converted
 * successfully and then can never be resolved back. Uploading that copy would
 * cost storage and change nothing on screen; the original stands alone and
 * renders as the download tile, which is what it did before this shipped.
 */
function isWorthUploading(preview: File, original: File): boolean {
  if (preview.size > DIRECT_UPLOAD_MAX_FILE_BYTES) return false;
  return isHeicByMetadata(
    directUploadContentType(original.type),
    original.name,
  );
}

function buildBatch(plans: UploadPlan[]): {
  entries: BatchEntry[];
  /** Position in `entries` of each picked file, in the order they were picked. */
  pickedAt: number[];
} {
  const entries: BatchEntry[] = [];
  const pickedAt: number[] = [];
  for (const plan of plans) {
    const index = entries.length;
    pickedAt.push(index);
    entries.push({ file: plan.file });
    if (plan.preview && isWorthUploading(plan.preview, plan.file)) {
      entries.push({ file: plan.preview, previewOfIndex: index });
    }
  }
  return { entries, pickedAt };
}

/** Storage could not be reached directly, so the buffered route may be tried. */
class DirectUploadUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectUploadUnavailableError";
  }
}

function putToStorage(
  ticket: DirectUploadTicket,
  file: File,
  onBytes: (loaded: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", ticket.uploadUrl, true);
    // The signature covers this header, so it must be sent exactly as issued.
    request.setRequestHeader("Content-Type", ticket.contentType);
    request.upload.onprogress = (event) => onBytes(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onBytes(file.size);
        resolve();
        return;
      }
      reject(
        new Error(
          `Storage rejected "${file.name}" (${request.status}). Please try again.`
        )
      );
    };
    // A CORS or network failure gives no status, so it is the one case where
    // the buffered route is still worth trying for a small file.
    request.onerror = () =>
      reject(new DirectUploadUnavailableError("Could not reach storage"));
    request.onabort = () =>
      reject(new DirectUploadUnavailableError("Upload was cancelled"));
    request.send(file);
  });
}

/**
 * Asks the server for one short-lived signed PUT per file (HTPR-5524), so a
 * video is no longer capped by the 4.5 MB serverless request-body ceiling.
 */
async function requestUploadTickets(
  files: BatchEntry[],
  issueTaskLinkReceipts = false,
): Promise<{ uploads: DirectUploadTicket[]; grant: string }> {
  const response = await axios
    .post<UploadUrlApiResponse>("/api/tasks/uploadUrl", {
      files: files.map(({ file, previewOfIndex }) => ({
        name: file.name,
        size: file.size,
        type: file.type || null,
        ...(previewOfIndex === undefined ? {} : { previewOfIndex }),
      })),
      ...(issueTaskLinkReceipts
        ? { purpose: "task-attachment-link" }
        : {}),
    })
    .catch((error: unknown) => {
      // The handshake itself being unreachable is exactly the case the buffered
      // route exists for, so it must not look different from storage being
      // unreachable. A 4xx is a real answer and is passed through.
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === undefined || status >= 500) {
        throw new DirectUploadUnavailableError("Could not reach the upload service");
      }
      return throwReadableUploadError(error);
    });

  const uploads = response.data?.uploads;
  const grant = response.data?.grant;
  if (!Array.isArray(uploads) || uploads.length !== files.length || !grant) {
    throw new DirectUploadUnavailableError(
      "Storage did not return an upload location"
    );
  }
  return { uploads, grant };
}

/** The original buffered path. Kept as the fallback for small files. */
async function uploadFilesViaBufferedApi(
  files: File[],
  onProgress?: (progress: number) => void,
  issueTaskLinkReceipts = false,
): Promise<UploadResult> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file, file.name);
  }

  const response = await axios.post<UploadApiResponse>(
    "/api/tasks/n8nUpload",
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
        ...(issueTaskLinkReceipts
          ? { "x-upload-purpose": "task-attachment-link" }
          : {}),
      },
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) {
          return;
        }
        const percent = Math.round((event.loaded * 100) / event.total);
        onProgress(percent);
      },
    }
  ).catch(throwReadableUploadError);

  const fileUrls = response.data?.fileUrls ?? [];
  const taskLinkReceipts = response.data?.taskLinkReceipts ?? [];
  if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
    throw new Error("Upload succeeded but no file URLs were returned");
  }
  if (
    issueTaskLinkReceipts &&
    (!Array.isArray(taskLinkReceipts) || taskLinkReceipts.length !== fileUrls.length)
  ) {
    throw new Error("Upload succeeded but no task link receipt was returned");
  }
  return { urls: fileUrls, taskLinkReceipts };
}

/**
 * Closes the handshake: the server verifies the stored size of everything kept
 * and deletes anything discarded. A cleanup call must never mask the original
 * failure, so only the verification call is allowed to throw.
 */
async function finalizeUploads(
  grant: string,
  keep: string[],
  discard: string[],
  issueTaskLinkReceipts = false,
): Promise<string[]> {
  if (keep.length === 0 && discard.length === 0) return [];
  const request = axios.post<UploadApiResponse>("/api/tasks/uploadFinalize", {
    grant,
    keep,
    discard,
    ...(issueTaskLinkReceipts ? { issueTaskLinkReceipts: true } : {}),
  });
  if (keep.length === 0) {
    await request.catch(() => undefined);
    return [];
  }
  const response = await request.catch(throwReadableUploadError);
  const receipts = response.data?.taskLinkReceipts ?? [];
  // A generated preview (HTPR-6264) is verified and kept but is not an
  // attachment, so it never gets a receipt and must not be counted as owed one.
  const linkable = keep.filter((key) => !isHeicPreviewUrl(key)).length;
  if (issueTaskLinkReceipts && receipts.length !== linkable) {
    throw new Error("Upload was verified but no task link receipt was returned");
  }
  return receipts;
}

async function uploadFilesViaApiInternal(
  requestedFiles: File[],
  onProgress?: (progress: number) => void,
  issueTaskLinkReceipts = false,
): Promise<UploadResult> {
  if (issueTaskLinkReceipts && requestedFiles.length !== 1) {
    throw new Error("Task-link uploads must contain exactly one file");
  }

  // HTPR-6264: last stop before the bytes leave the browser. A HEIC is paired
  // here with a JPEG copy of itself, and both are sent: the original so it can
  // still be downloaded, the copy so every picture surface has something an
  // <img> can paint. Everything else plans to a single untouched file.
  //
  // This must run before the size check and before the handshake, because both
  // read the names, sizes and types it produces, and each signed PUT is bound
  // to one of those exact content types.
  const plans = await planUploadFiles(requestedFiles);
  const { entries, pickedAt } = buildBatch(plans);
  const picked = plans.map((plan) => plan.file);

  // Check before sending: nothing above the direct-upload ceiling is accepted.
  const sizeError = getDirectUploadSizeError(
    entries.map(({ file, previewOfIndex }) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      previewOfIndex,
    })),
  );
  if (sizeError) {
    throw new UploadTooLargeError(sizeError);
  }

  let uploads: DirectUploadTicket[];
  let grant: string;
  try {
    ({ uploads, grant } = await requestUploadTickets(
      entries,
      issueTaskLinkReceipts,
    ));
  } catch (error) {
    // No tickets at all, so nothing has been uploaded yet and the whole batch
    // can still go the buffered way when it is small enough.
    if (
      !(error instanceof DirectUploadUnavailableError) ||
      getUploadSizeError(picked) !== null
    ) {
      throw error;
    }
    onProgress?.(0);
    // Previews are dropped here on purpose. The buffered route mints its own
    // unrelated key per file, so a preview sent through it could not be found
    // from the original's URL and would just be an orphan paying for storage.
    // Losing it costs a HEIC its thumbnail, which is the HTPR-6254 download
    // chip, not a broken page.
    return uploadFilesViaBufferedApi(
      picked,
      onProgress,
      issueTaskLinkReceipts,
    );
  }

  const files = entries.map((entry) => entry.file);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) || 1;
  const loaded = files.map(() => 0);
  const report = () => {
    if (!onProgress) return;
    const sent = loaded.reduce((sum, bytes) => sum + bytes, 0);
    onProgress(Math.min(100, Math.round((sent * 100) / totalBytes)));
  };

  // Fall back per file, never per batch: a file that already reached storage
  // must not be uploaded a second time or left behind unreferenced.
  const stored: string[] = [];
  // Every worker is awaited before cleanup, so a PUT that lands just after a
  // sibling fails is still deleted rather than left unreferenced.
  const settled = await Promise.allSettled(
    entries.map(async ({ file, previewOfIndex }, index) => {
      const isPreview = previewOfIndex !== undefined;
      try {
        await putToStorage(uploads[index], file, (bytes) => {
          loaded[index] = bytes;
          report();
        });
        stored.push(uploads[index].key);
        return uploads[index].fileUrl;
      } catch (error) {
        // A preview is a nicety, and it is not what the user attached. Letting
        // it fail the batch would lose the photo over a missing thumbnail, so a
        // preview that will not upload is simply abandoned: the HEIC renders as
        // the HTPR-6254 download chip, exactly as it did before HTPR-6264.
        if (isPreview) {
          loaded[index] = file.size;
          report();
          return { abandonedPreview: true as const };
        }
        if (
          !(error instanceof DirectUploadUnavailableError) ||
          getUploadSizeError([file]) !== null
        ) {
          throw error;
        }
        // The bytes may still have landed before the connection dropped, so the
        // direct object is discarded before the buffered retry.
        stored.push(uploads[index].key);
        const fallback = await uploadFilesViaBufferedApi(
          [file],
          undefined,
          issueTaskLinkReceipts,
        );
        loaded[index] = file.size;
        report();
        return {
          fallbackUrl: fallback.urls[0],
          fallbackReceipt: fallback.taskLinkReceipts[0],
          discardKey: uploads[index].key,
        };
      }
    })
  );

  const failure = settled.find((result) => result.status === "rejected");
  if (failure) {
    await finalizeUploads(grant, [], stored);
    throw (failure as PromiseRejectedResult).reason;
  }

  const urlAt: (string | null)[] = [];
  const discard: string[] = [];
  let fallbackReceipt: string | undefined;
  settled.forEach((result, index) => {
    const value = (result as PromiseFulfilledResult<unknown>).value;
    if (typeof value === "string") {
      urlAt[index] = value;
      return;
    }
    if ((value as { abandonedPreview?: boolean }).abandonedPreview) {
      urlAt[index] = null;
      return;
    }
    const fallback = value as {
      fallbackUrl: string;
      fallbackReceipt?: string;
      discardKey: string;
    };
    urlAt[index] = fallback.fallbackUrl;
    fallbackReceipt = fallback.fallbackReceipt;
    discard.push(fallback.discardKey);
  });

  // A file that fell back to the buffered route has a new, unrelated key, so
  // the preview signed against its discarded one can never be found from the
  // URL that was actually stored. Left alone it would sit in the bucket forever
  // as an orphan nothing references. Done in a second pass so every entry's
  // outcome is known.
  entries.forEach(({ previewOfIndex }, index) => {
    if (previewOfIndex === undefined) return;
    const originalFellBack = discard.includes(uploads[previewOfIndex].key);
    if (originalFellBack && urlAt[index] !== null) {
      discard.push(uploads[index].key);
    }
  });

  // Only the files the user picked become attachments; a preview is addressed
  // by deriving its URL from its original's, never returned as one of its own.
  const urls = pickedAt.map((index) => urlAt[index] as string);

  // The signed PUT cannot carry a size limit, so the server checks the stored
  // length and removes anything above the per-file or batch ceiling.
  const directReceipts = await finalizeUploads(
    grant,
    stored.filter((key) => !discard.includes(key)),
    discard,
    issueTaskLinkReceipts && !fallbackReceipt,
  );

  onProgress?.(100);
  return {
    urls,
    taskLinkReceipts: issueTaskLinkReceipts
      ? [fallbackReceipt ?? directReceipts[0]].filter(
          (receipt): receipt is string => Boolean(receipt),
        )
      : [],
  };
}

export async function uploadFilesViaApi(
  files: File[],
  onProgress?: (progress: number) => void,
): Promise<string[]> {
  return (await uploadFilesViaApiInternal(files, onProgress)).urls;
}

export async function uploadSingleFileViaApi(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const urls = await uploadFilesViaApi([file], onProgress);
  return urls[0];
}

export async function uploadSingleTaskAttachment(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<TaskAttachmentUploadReceipt> {
  const result = await uploadFilesViaApiInternal([file], onProgress, true);
  const url = result.urls[0];
  const receipt = result.taskLinkReceipts[0];
  if (!url || !receipt) {
    throw new Error("Upload completed without a task link receipt");
  }
  return { url, receipt };
}
