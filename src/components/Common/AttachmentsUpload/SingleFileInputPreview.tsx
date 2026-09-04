import { buildStyles, CircularProgressbar } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import toast from "react-hot-toast";
import { uploadSingleFileViaApi } from "@/lib/storage/uploadViaApi";
import { UploadTooLargeError } from "@/lib/storage/uploadLimits";
import {
  createTaskUploadById,
  createTaskUploadIsReserved,
  markedCreateTaskAttachment,
  startCreateTaskUpload,
  subscribeCreateTaskUploads,
} from "@/lib/createTaskAttachmentUploads";

interface ISingleFile {
    id:number;
    index: number;
    showModalImage: any;
    shouldUpload: boolean;
    file: any;
    allowDelete?: boolean;
    handleRemove: any;
    callback?:(attachmentReturned: any) => void;
    onUploadFailed?: (fileName: string) => void;
    variant?: "default" | "chat";
    backgroundTaskUpload?: boolean;
  }
  const SingleFileInputPreview: React.FC<ISingleFile> = ({
    id,
    index,
    showModalImage,
    file,
    handleRemove,
    allowDelete,
    shouldUpload,
    callback,
    onUploadFailed: reportUploadFailure,
    variant = "default",
    backgroundTaskUpload = false,
  }) => {
    // if upload is true, we will display a progress bar here, and show its progress.
    // upon 100 percent completion, we will do a callback and send it back.
    const [progressPercentage, setProgressBar] = useState<number>(0);
    const previewImageRef = useRef<HTMLImageElement>(null);
    const backgroundUploadIdRef = useRef<string | undefined>(undefined);
    const latestHandlersRef = useRef({
      callback,
      handleRemove,
      reportUploadFailure,
    });
    useEffect(() => {
      latestHandlersRef.current = {
        callback,
        handleRemove,
        reportUploadFailure,
      };
    }, [callback, handleRemove, reportUploadFailure]);

    useEffect(() => {
      if (!file.type?.startsWith("image/") || file.source) return;
      const url = URL.createObjectURL(file);
      if (previewImageRef.current) previewImageRef.current.src = url;
      return () => URL.revokeObjectURL(url);
    }, [file]);

    const hasCallback = Boolean(callback);
    useEffect(() => {
      let active = true;
      let unsubscribe: () => void = () => undefined;
      const uploadFile = async () => {
        if (!shouldUpload || !hasCallback) return;
        if (file.source) {
          setProgressBar(100);
          latestHandlersRef.current.callback?.({ id: file.id, file });
          return;
        }

        if (backgroundTaskUpload) {
          const started = startCreateTaskUpload(file);
          backgroundUploadIdRef.current = started.id;
          const syncProgress = () => {
            const job = createTaskUploadById(started.id);
            if (active && job) setProgressBar(job.progress);
          };
          unsubscribe = subscribeCreateTaskUploads(syncProgress);
          try {
            syncProgress();
            const uploaded = await started.promise;
            if (!active) return;
            latestHandlersRef.current.callback?.({
              id,
              file: markedCreateTaskAttachment(started.id, file, uploaded.url),
            });
          } finally {
            unsubscribe();
          }
          return;
        }

        const source = await uploadSingleFileViaApi(file, (progress) => {
          if (active) setProgressBar(progress);
        });
        if (!active) return;
        console.log("🚀 ~ uploadFile ~ result:", source);
        const extractedFile = {
          name: file.name,
          size: file.size,
          type: file.type,
        };
        const itemToReturn = { id, file: { ...extractedFile, source } };
        console.log("🚀 ~ uploadFile ~ itemToReturn:", itemToReturn);
        latestHandlersRef.current.callback?.(itemToReturn);
      };

      void uploadFile().catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof UploadTooLargeError
            ? error.message
            : `Could not upload "${file.name}". Please try again.`;
        toast.error(message);
        const reservedForSave =
          backgroundTaskUpload &&
          backgroundUploadIdRef.current &&
          createTaskUploadIsReserved(backgroundUploadIdRef.current);
        if (!reservedForSave) {
          latestHandlersRef.current.handleRemove?.(file.name);
        }
        latestHandlersRef.current.reportUploadFailure?.(file.name);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    }, [backgroundTaskUpload, file, hasCallback, id, shouldUpload]);

    const isImage = file.type?.startsWith("image/");
    const isChat = variant === "chat";

    return (
      <div
        className={`cursor-pointer relative z-0 h-fit items-end ${
          isChat ? "w-[60px] max-w-[60px]" : "mb-2 w-max-[60px]  h-max-[60px]"
        }`}
        key={index}
      >
        <div
          onClick={() => showModalImage(index)}
          className={`items-center w-full flex flex-col rounded-md bg-[#27292D] text-white ${
            isChat
              ? "min-h-0 min-w-0 justify-start p-1"
              : "h-full justify-end p-1 sm:p-2"
          }`}
        >
          {/* Preview: same square frame for images and PDFs/docs in chat */}
          <div
            className={
              isChat
                ? "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md bg-secondary"
                : `${isImage ? "attachment-image" : "attachment-others"} grid bg-secondary`
            }
          >
            {isImage ? (
              <img
                ref={previewImageRef}
                className={
                  isChat
                    ? "h-full w-full rounded-md object-contain"
                    : "h-[28px] w-[28px] object-contain sm:h-full sm:w-[60px]"
                }
                src={file.source}
                alt={file.name}
                onClick={() => showModalImage(index)}
              />
            ) : (
              <Paperclip size={18}
                className={
                  isChat
                    ? "text-display text-white/90"
                    : "text-center text-heading"
                }
                strokeWidth={1.75}
              />
            )}
          </div>
          <span
            className={`text-center text-white ${
              isChat
                ? "mt-1 w-full min-w-0 max-w-full shrink-0 break-words px-0.5 py-0 text-micro font-normal leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                : "overflow-hidden py-2 text-micro h-[32px] w-[60px] line-clamp-3 sm:line-clamp-1"
            }`}
            title={file.name}
          >
            {file.name}
          </span>
        </div>
        {
          allowDelete && handleRemove && (!shouldUpload || progressPercentage === 100) ? (
            <X size={18}
              className="absolute z-10 top-0 right-0 text-white-black rounded-full cursor-pointer xs:text-subheading sm:text-emphasis bg-red-600"
              onClick={() => handleRemove(file.name)}
              strokeWidth={1.75}
            />
          )
          :<></>
        } 
        {
          shouldUpload&& progressPercentage<100&&
          <div className="absolute z-10 top-[-5px] right-[-5px] h-[26px] w-[26px] bg-[#27292D] rounded-full p-1" >

            <CircularProgressbar
              strokeWidth={14}
              value={progressPercentage} 
              styles={buildStyles({
                textColor: "#fff",
                pathColor: "#C2CFA5",
                trailColor: "#27292D",
              })}
              // indicatorColor='#191A1F'
            />
          </div>
        }
      </div>
    );
  };
  

  export default SingleFileInputPreview;
