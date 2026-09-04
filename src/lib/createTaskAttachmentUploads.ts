import {
  uploadSingleTaskAttachment,
  type TaskAttachmentUploadReceipt,
} from "@/lib/storage/uploadViaApi";
import type { IAttachment } from "@/models/model";

export const CREATE_TASK_UPLOAD_ID = "createTaskUploadId" as const;

export type CreateTaskUploadStatus =
  | "uploading"
  | "uploaded"
  | "upload-failed"
  | "linking"
  | "link-failed"
  | "complete";

export type CreateTaskUploadSnapshot = {
  id: string;
  taskId?: number;
  file: File;
  progress: number;
  status: CreateTaskUploadStatus;
  source?: string;
  attachment?: IAttachment;
};

type Upload = (
  file: File,
  onProgress: (progress: number) => void,
) => Promise<TaskAttachmentUploadReceipt>;
type Link = (
  taskId: number,
  receipt: string,
) => Promise<IAttachment>;
type Discard = (receipt: string) => Promise<void>;

type UploadJob = CreateTaskUploadSnapshot & {
  receipt?: string;
  reserved: boolean;
  discarded: boolean;
  discardWhenReleased: boolean;
  promise: Promise<TaskAttachmentUploadReceipt>;
  upload: Upload;
  link: Link;
  discard: Discard;
};

type MarkedAttachment = {
  [CREATE_TASK_UPLOAD_ID]?: string;
  source?: string;
};

let nextId = 0;
let version = 0;
const jobs = new Map<string, UploadJob>();
const jobsByFile = new WeakMap<File, UploadJob>();
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function patch(job: UploadJob, update: Partial<UploadJob>) {
  Object.assign(job, update);
  emit();
}

async function defaultLink(
  taskId: number,
  receipt: string,
): Promise<IAttachment> {
  const response = await fetch("/api/tasks/uploadFinalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "link-task-attachment",
      taskId,
      receipt,
    }),
  });
  const parsed = await response.json().catch(() => null);
  const body =
    parsed && typeof parsed === "object"
      ? (parsed as { attachment?: IAttachment; error?: string })
      : {};
  if (!response.ok || !body.attachment) {
    throw new Error(body.error || "Could not link attachment");
  }
  return body.attachment;
}

async function defaultDiscard(receipt: string): Promise<void> {
  await fetch("/api/tasks/uploadFinalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discard-task-attachment",
      receipt,
    }),
    keepalive: true,
  });
}

function discardReceipt(job: UploadJob, receipt: string) {
  void Promise.resolve()
    .then(() => job.discard(receipt))
    .catch(() => undefined);
}

function discardJob(job: UploadJob) {
  if (job.discarded) return;
  job.discarded = true;
  jobs.delete(job.id);
  jobsByFile.delete(job.file);
  if (job.receipt) discardReceipt(job, job.receipt);
}

function runUpload(job: UploadJob) {
  patch(job, {
    status: "uploading",
    progress: 0,
    source: undefined,
    receipt: undefined,
  });
  let promise: Promise<TaskAttachmentUploadReceipt>;
  try {
    promise = job.upload(job.file, (progress) => {
      if (!job.discarded) patch(job, { progress });
    });
  } catch (error) {
    promise = Promise.reject(error);
  }
  job.promise = promise;
  void promise.then(
    ({ url, receipt }) => {
      if (job.discarded) {
        job.receipt = receipt;
        discardReceipt(job, receipt);
        return;
      }
      patch(job, { status: "uploaded", progress: 100, source: url, receipt });
      if (job.taskId) void runLink(job);
    },
    () => {
      if (!job.discarded) patch(job, { status: "upload-failed" });
    },
  );
  return promise;
}

async function runLink(job: UploadJob) {
  if (!job.taskId || !job.receipt || job.status === "linking") return;
  patch(job, { status: "linking" });
  try {
    const attachment = await job.link(job.taskId, job.receipt);
    patch(job, { status: "complete", attachment });
  } catch {
    // The receipt remains valid. Retry links the same verified object instead
    // of uploading a second copy after a lost success response.
    patch(job, { status: "link-failed" });
  }
}

export function startCreateTaskUpload(
  file: File,
  upload: Upload = uploadSingleTaskAttachment,
  link: Link = defaultLink,
  discard: Discard = defaultDiscard,
) {
  const existing = jobsByFile.get(file);
  if (existing) return { id: existing.id, promise: existing.promise };

  const id = `create-task-upload-${Date.now()}-${nextId++}`;
  const job = {
    id,
    file,
    progress: 0,
    status: "uploading" as const,
    reserved: false,
    discarded: false,
    discardWhenReleased: false,
    promise: Promise.resolve({ url: "", receipt: "" }),
    upload,
    link,
    discard,
  };
  jobs.set(id, job);
  jobsByFile.set(file, job);
  return { id, promise: runUpload(job) };
}

export function markedCreateTaskAttachment(
  id: string,
  file: File,
  source: string,
) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    source,
    [CREATE_TASK_UPLOAD_ID]: id,
  };
}

function jobForAttachment(attachment: unknown): UploadJob | undefined {
  if (!attachment || typeof attachment !== "object") return undefined;
  if (typeof File !== "undefined" && attachment instanceof File) {
    return jobsByFile.get(attachment);
  }
  const nestedFile = (attachment as { file?: unknown }).file;
  if (typeof File !== "undefined" && nestedFile instanceof File) {
    return jobsByFile.get(nestedFile);
  }
  const id =
    (attachment as MarkedAttachment)[CREATE_TASK_UPLOAD_ID] ??
    (nestedFile as MarkedAttachment | undefined)?.[CREATE_TASK_UPLOAD_ID];
  return id ? jobs.get(id) : undefined;
}

export function reserveCreateTaskUploads(attachments: unknown[]) {
  attachments.forEach((attachment) => {
    const job = jobForAttachment(attachment);
    if (job) job.reserved = true;
  });
}

export function releaseCreateTaskUploadReservations(attachments: unknown[]) {
  let discarded = false;
  attachments.forEach((attachment) => {
    const job = jobForAttachment(attachment);
    if (!job || job.taskId) return;
    job.reserved = false;
    if (!job.discardWhenReleased) return;
    discardJob(job);
    discarded = true;
  });
  if (discarded) emit();
}

export function createTaskUploadIsReserved(id: string) {
  return jobs.get(id)?.reserved === true;
}

export function createTaskUploadCount(attachments: unknown[]): number {
  return new Set(
    attachments
      .map((attachment) => jobForAttachment(attachment)?.id)
      .filter((id): id is string => Boolean(id)),
  ).size;
}

export function bindCreateTaskUploads(
  taskId: number,
  attachments: unknown[],
): number {
  const bound = new Set<string>();
  attachments.forEach((attachment) => {
    const job = jobForAttachment(attachment);
    if (
      !job ||
      bound.has(job.id) ||
      (job.taskId !== undefined && job.taskId !== taskId)
    ) return;
    bound.add(job.id);
    patch(job, { taskId, reserved: false, discardWhenReleased: false });
    if (job.status === "uploaded" || job.status === "link-failed") {
      void runLink(job);
    }
  });
  return bound.size;
}

export function retryCreateTaskUpload(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.status === "upload-failed") {
    void runUpload(job).catch(() => undefined);
    return;
  }
  if (job.status === "link-failed") void runLink(job);
}

export function discardUnboundCreateTaskUploads(attachments: unknown[]) {
  attachments.forEach((attachment) => {
    const job = jobForAttachment(attachment);
    if (!job || job.taskId) return;
    if (job.reserved) {
      job.discardWhenReleased = true;
      return;
    }
    discardJob(job);
  });
  emit();
}

export function acknowledgeCreateTaskUpload(id: string) {
  const job = jobs.get(id);
  if (!job || job.status !== "complete") return;
  jobs.delete(id);
  jobsByFile.delete(job.file);
  emit();
}

export function subscribeCreateTaskUploads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createTaskUploadsVersion() {
  return version;
}

export function createTaskUploadById(
  id: string,
): CreateTaskUploadSnapshot | undefined {
  return jobs.get(id);
}

export function createTaskUploadsForTask(
  taskId: number,
): CreateTaskUploadSnapshot[] {
  return [...jobs.values()]
    .filter((job) => job.taskId === taskId)
    .map(({ id, taskId: idOfTask, file, progress, status, source, attachment }) => ({
      id,
      taskId: idOfTask,
      file,
      progress,
      status,
      source,
      attachment,
    }));
}

// ponytail: this survives React navigation, not a reload or mobile browser
// eviction. A durable upload-session service worker is the upgrade path.
