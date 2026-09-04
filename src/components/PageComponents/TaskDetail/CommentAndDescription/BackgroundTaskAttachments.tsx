"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { CircleAlert, Paperclip, RotateCcw } from "lucide-react";
import { buildStyles, CircularProgressbar } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";
import type { IAttachment } from "@/models/model";
import {
  acknowledgeCreateTaskUpload,
  createTaskUploadsForTask,
  createTaskUploadsVersion,
  retryCreateTaskUpload,
  subscribeCreateTaskUploads,
  type CreateTaskUploadSnapshot,
} from "@/lib/createTaskAttachmentUploads";

function PendingImage({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imageRef.current) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      alt=""
      className="h-[36px] w-[60px] rounded-md object-contain"
    />
  );
}

function PendingAttachment({ upload }: { upload: CreateTaskUploadSnapshot }) {
  const isImage = upload.file.type.startsWith("image/");
  const failed = upload.status === "upload-failed" || upload.status === "link-failed";

  return (
    <div className="relative mb-2 flex min-h-[76px] w-[72px] flex-col items-center rounded-md bg-cardBackground p-1 text-white-black sm:p-2">
      <div className="grid h-[36px] w-[60px] place-items-center rounded-md bg-secondary">
        {isImage ? (
          <PendingImage file={upload.file} />
        ) : (
          <Paperclip size={18} className="text-heading" strokeWidth={1.75} aria-hidden />
        )}
      </div>
      <span className="h-[32px] w-[60px] overflow-hidden py-2 text-center text-micro line-clamp-1" title={upload.file.name}>
        {upload.file.name}
      </span>
      {failed ? (
        <>
          <CircleAlert
            size={24}
            className="absolute right-[-5px] top-[-5px] rounded-full bg-cardBackground p-1 text-destructive"
            aria-label="Upload failed"
          />
          <button
            type="button"
            onClick={() => retryCreateTaskUpload(upload.id)}
            className="flex min-h-6 items-center gap-1 text-micro font-semibold text-destructive"
          >
            <RotateCcw size={12} strokeWidth={2} aria-hidden />
            Retry
          </button>
        </>
      ) : (
        <div className="absolute right-[-5px] top-[-5px] h-[26px] w-[26px] rounded-full bg-cardBackground p-1" aria-label="Uploading">
          <CircularProgressbar
            strokeWidth={14}
            value={upload.status === "linking" ? 100 : upload.progress}
            styles={buildStyles({
              pathColor: "#C2CFA5",
              trailColor: "var(--bg-cardBackground)",
            })}
          />
        </div>
      )}
    </div>
  );
}

export default function BackgroundTaskAttachments({
  taskId,
  onLinked,
}: {
  taskId: number;
  onLinked: (attachment: IAttachment) => void;
}) {
  const version = useSyncExternalStore(
    subscribeCreateTaskUploads,
    createTaskUploadsVersion,
    () => 0,
  );
  const uploads = useMemo(
    () => createTaskUploadsForTask(taskId),
    [taskId, version],
  );

  useEffect(() => {
    uploads.forEach((upload) => {
      if (upload.status !== "complete" || !upload.attachment) return;
      onLinked(upload.attachment);
      acknowledgeCreateTaskUpload(upload.id);
    });
  }, [onLinked, uploads]);

  const visible = uploads.filter((upload) => upload.status !== "complete");
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 py-2" aria-label="Background uploads">
      {visible.map((upload) => (
        <PendingAttachment key={upload.id} upload={upload} />
      ))}
    </div>
  );
}
