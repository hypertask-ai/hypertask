import axios from "axios";

import {
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
  files: File[]
): Promise<{ uploads: DirectUploadTicket[]; grant: string }> {
  const response = await axios
    .post<UploadUrlApiResponse>("/api/tasks/uploadUrl", {
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || null,
      })),
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
  onProgress?: (progress: number) => void
): Promise<string[]> {
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
  if (!Array.isArray(fileUrls) || fileUrls.length === 0) {
    throw new Error("Upload succeeded but no file URLs were returned");
  }
  return fileUrls;
}

/**
 * Closes the handshake: the server verifies the stored size of everything kept
 * and deletes anything discarded. A cleanup call must never mask the original
 * failure, so only the verification call is allowed to throw.
 */
async function finalizeUploads(
  grant: string,
  keep: string[],
  discard: string[]
) {
  if (keep.length === 0 && discard.length === 0) return;
  const request = axios.post("/api/tasks/uploadFinalize", {
    grant,
    keep,
    discard,
  });
  if (keep.length === 0) {
    await request.catch(() => undefined);
    return;
  }
  await request.catch(throwReadableUploadError);
}

export async function uploadFilesViaApi(
  files: File[],
  onProgress?: (progress: number) => void
): Promise<string[]> {
  // Check before sending: nothing above the direct-upload ceiling is accepted.
  const sizeError = getDirectUploadSizeError(files);
  if (sizeError) {
    throw new UploadTooLargeError(sizeError);
  }

  let uploads: DirectUploadTicket[];
  let grant: string;
  try {
    ({ uploads, grant } = await requestUploadTickets(files));
  } catch (error) {
    // No tickets at all, so nothing has been uploaded yet and the whole batch
    // can still go the buffered way when it is small enough.
    if (
      !(error instanceof DirectUploadUnavailableError) ||
      getUploadSizeError(files) !== null
    ) {
      throw error;
    }
    onProgress?.(0);
    return uploadFilesViaBufferedApi(files, onProgress);
  }

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
    files.map(async (file, index) => {
      try {
        await putToStorage(uploads[index], file, (bytes) => {
          loaded[index] = bytes;
          report();
        });
        stored.push(uploads[index].key);
        return uploads[index].fileUrl;
      } catch (error) {
        if (
          !(error instanceof DirectUploadUnavailableError) ||
          getUploadSizeError([file]) !== null
        ) {
          throw error;
        }
        // The bytes may still have landed before the connection dropped, so the
        // direct object is discarded before the buffered retry.
        stored.push(uploads[index].key);
        const [url] = await uploadFilesViaBufferedApi([file]);
        loaded[index] = file.size;
        report();
        return { fallbackUrl: url, discardKey: uploads[index].key };
      }
    })
  );

  const failure = settled.find((result) => result.status === "rejected");
  if (failure) {
    await finalizeUploads(grant, [], stored);
    throw (failure as PromiseRejectedResult).reason;
  }

  const urls: string[] = [];
  const discard: string[] = [];
  for (const result of settled) {
    const value = (result as PromiseFulfilledResult<unknown>).value;
    if (typeof value === "string") {
      urls.push(value);
      continue;
    }
    const fallback = value as { fallbackUrl: string; discardKey: string };
    urls.push(fallback.fallbackUrl);
    discard.push(fallback.discardKey);
  }

  // The signed PUT cannot carry a size limit, so the server checks the stored
  // length and removes anything above the per-file or batch ceiling.
  await finalizeUploads(
    grant,
    stored.filter((key) => !discard.includes(key)),
    discard
  );

  onProgress?.(100);
  return urls;
}

export async function uploadSingleFileViaApi(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const urls = await uploadFilesViaApi([file], onProgress);
  return urls[0];
}
