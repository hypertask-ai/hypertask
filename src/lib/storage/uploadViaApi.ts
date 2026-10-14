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
  grant?: string;
};

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

type BatchEntry = {
  file: File;
  previewOfIndex?: number;
};

function isWorthUploading(preview: File, original: File): boolean {
  if (preview.size > DIRECT_UPLOAD_MAX_FILE_BYTES) return false;
  return isHeicByMetadata(
    directUploadContentType(original.type),
    original.name,
  );
}

function buildBatch(plans: UploadPlan[]): {
  entries: BatchEntry[];
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
    request.onerror = () =>
      reject(new DirectUploadUnavailableError("Could not reach storage"));
    request.onabort = () =>
      reject(new DirectUploadUnavailableError("Upload was cancelled"));
    request.send(file);
  });
}

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

  const plans = await planUploadFiles(requestedFiles);
  const { entries, pickedAt } = buildBatch(plans);
  const picked = plans.map((plan) => plan.file);

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
    if (
      !(error instanceof DirectUploadUnavailableError) ||
      getUploadSizeError(picked) !== null
    ) {
      throw error;
    }
    onProgress?.(0);
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

  const stored: string[] = [];
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

  entries.forEach(({ previewOfIndex }, index) => {
    if (previewOfIndex === undefined) return;
    const originalFellBack = discard.includes(uploads[previewOfIndex].key);
    if (originalFellBack && urlAt[index] !== null) {
      discard.push(uploads[index].key);
    }
  });

  const urls = pickedAt.map((index) => urlAt[index] as string);

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
