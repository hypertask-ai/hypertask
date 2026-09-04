import { buildStyles, CircularProgressbar } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

import { useEffect, useState } from "react";
import { Paperclip, X } from "lucide-react";
import toast from "react-hot-toast";
import { uploadSingleFileViaApi } from "@/lib/storage/uploadViaApi";
import { UploadTooLargeError } from "@/lib/storage/uploadLimits";

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
  }) => {
    // if upload is true, we will display a progress bar here, and show its progress. 
    // upon 100 percent completion, we will do a callback and send it back. 
    const [uploadString, setUploadString] = useState<string>(file.source??"");


    const [progressPercentage, setProgressBar] = useState<number>(0);
    const onMountUploadIfFile = async()=>{

      // is this not an uploading component then return
      if (!shouldUpload || !callback )return 
      else{
        // is the file already added? meaning we're editing something, then just make a callback.
        if (uploadString && shouldUpload){
          setProgressBar(100)
          callback({id:file.id, file})
        }
  
        else{

          // ================== we will upload and THEN make the callback
          const source = await uploadSingleFileViaApi(file, setProgressBar);
          console.log("🚀 ~ onMountUploadIfFile ~ result:", source)
          setUploadString(source)
          // console.log("🚀 ~ onMountUploadIfFile ~ file:", file)
          // Manually extracting properties
          const extractedFile = {
            name: file.name,
            size: file.size,
            type: file.type,
            // Add other properties as needed
          };
          const ItemToReturn = {id,file:{...extractedFile,source} }
          console.log("🚀 ~ onMountUploadIfFile ~ ItemToReturn:", ItemToReturn)
          callback(ItemToReturn)
        }

      }
      
    }

    
    // A failed upload must surface as a message, not an unhandled rejection that
    // leaves the progress ring spinning forever (HTPR-5516).
    const onUploadFailed = (error: unknown) => {
      const message =
        error instanceof UploadTooLargeError
          ? error.message
          : `Could not upload "${file.name}". Please try again.`;
      toast.error(message);
      handleRemove?.(file.name);
      reportUploadFailure?.(file.name);
    };

    useEffect(()=>{
      onMountUploadIfFile().catch(onUploadFailed)
    },[])

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
                className={
                  isChat
                    ? "h-full w-full rounded-md object-contain"
                    : "h-[28px] w-[28px] object-contain sm:h-full sm:w-[60px]"
                }
                src={file.source ? file.source : URL.createObjectURL(file)}
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
