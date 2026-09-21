"use client"

import { useCallback, useRef, useState } from "react"

import { Upload } from "lucide-react";
import { Progress } from "reactstrap"
import { IAttachment } from "@/models/model"
import { useRecoilState } from "@/lib/state"
import { currentProjectAtom } from "@/store"
import { useCustomAiInstructions } from "@/lib/contexts/Multipages/customAiInstructionContext"
import globalConstants from "@/lib/constants"
import axiosClient from "@/utils/axiosClient"
import toast from "react-hot-toast"
import { uploadSingleFileViaApi } from "@/lib/storage/uploadViaApi"
interface FileUploaderProps {
  onUpload: (files: IAttachment[]) => void;
  existingFiles:IAttachment[]
}

export function FileUploader({ onUpload, existingFiles }: FileUploaderProps) {
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [_currentProject, __] = useRecoilState(currentProjectAtom)
  const { loading, setLoading } = useCustomAiInstructions()


  const onDrop = async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
  
      setLoading(true);
  
      const existingFileNames = new Set(existingFiles.map(f => f.fileName));
      const renamedFiles: File[] = [];
      const nameCountMap: Record<string, number> = {};
  
      acceptedFiles.forEach((file) => {
        const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
        const baseName = file.name.replace(ext, '');
        let newName = file.name;
  
        while (existingFileNames.has(newName)) {
          nameCountMap[baseName] = (nameCountMap[baseName] || 0) + 1;
          newName = `${baseName} (${nameCountMap[baseName]})${ext}`;
        }
  
        existingFileNames.add(newName);
        const renamedFile = new File([file], newName, { type: file.type });
        renamedFiles.push(renamedFile);
      });
  
      // Initialize progress tracking
      const initialProgress: Record<string, number> = {};
      renamedFiles.forEach((file) => {
        initialProgress[file.name] = 0;
      });
      setUploadProgress(initialProgress);
  
      // Upload files
      const uploadPromises = renamedFiles.map((file) => {
        return new Promise<IAttachment>(async (resolve) => {
          const { uploadAttachmentToAICustomInstruction } = await import("@/lib/serverActions");
  
          try {
            const source = await uploadSingleFileViaApi(file, (progress: number) => {
              setUploadProgress((prev) => ({
                ...prev,
                [file.name]: progress,
              }));
            });
            const instructionId = _currentProject?.ai_custom_instructions?.[0].id;
            if (!instructionId) {
              throw new Error("Missing AI custom instruction id");
            }
            const uploadedFileFromRAG = await uploadAttachmentToAICustomInstruction({
              fileSize: file.size,
              name: file.name,
              S3URL: source,
              type: file.type,
              AI_Custom_Instructions_id: instructionId,
            });
            console.log("🚀 ~ returnnewPromise<IAttachment> ~ uploadedFileFromRAG:", uploadedFileFromRAG)
            console.log("🚀 ~ returnnewPromise<IAttachment> ~ source:", source)

            if (uploadedFileFromRAG && isIAttachment(uploadedFileFromRAG.data) && uploadedFileFromRAG.status === 200) {
              resolve(uploadedFileFromRAG.data);
            } else {
              throw new Error("Upload failed");
            }
          } catch (error) {
            console.error(`Error uploading file ${file.name}:`, error);
            resolve({
              id: -1,
              fileName: file.name,
              fileSize: String(file.size),
              fileType: file.type,
              createdAt: new Date(),
              fileSource: '',
            });
          }
        });
      });
  
      Promise.all(uploadPromises).then(async (uploadedFiles) => {
        try {
          const source = uploadedFiles.map(x=>(x.fileSource))
          console.log("🚀 ~ Promise.all ~ uploadedFiles:", uploadedFiles)
          console.log("🚀 ~ Promise.all ~ source:", source)
          const payload = {
            URLs:source,
            teamId:_currentProject?.teamId,
            projectId:_currentProject?.id
          }
          const response = await axiosClient.post(globalConstants.uploadFilesToRagAPI, payload)
          if(response.status === 200){
            onUpload(uploadedFiles);
            toast.success("Files uploaded successfully");
          } 
          console.log("🚀 ~ apiHit ~ response:", response.data)
        } catch (error) {
          console.error("🚀 ~ apiHit ~ error:", error)
          toast.error("Error uploading files");
        } finally {
          setLoading(false);
          setUploadProgress({});
        }
      });
    }

  const handleAttachmentClick = (e?: any) => {
    e?.stopPropagation();
    fileInputRef?.current?.click();
  };
  return (
    <div
      className={`border-2 border-dashed rounded-lg p-4 transition-colors ${"border-muted-foreground/20"
        }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="
          application/pdf,
          application/json,
          application/vnd.openxmlformats-officedocument.wordprocessingml.document,
          text/plain,
          image/png,
          image/jpeg,
          image/gif,
          image/bmp
        "        
        multiple
        onChange={(event) => {
          const files = event.target.files ? Array.from(event.target.files) : [];
          onDrop(files);
        }}
        style={{ display: "none", color: "white" }}
      />

      <div className="flex flex-col items-center justify-center gap-3 py-2">
        <div className="rounded-full bg-primary/10 p-2">
          <Upload strokeWidth={1.75} className="h-5 w-5 text-primary" />
        </div>


        <button className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm px-3 text-dense font-medium bg-label-span text-white-black hover:bg-hover-active border-0" type="button" onClick={handleAttachmentClick} disabled={loading}>
          Select Files
        </button>
      </div>

      {loading && Object.keys(uploadProgress).length > 0 && (
        <div className="mt-3 space-y-2">
          {Object.entries(uploadProgress).map(([fileName, progress]) => (
            <div key={fileName} className="space-y-1">
              <div className="flex justify-between items-center text-meta">
                <span className="truncate max-w-[200px]">{fileName}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Define a type guard
function isIAttachment(obj: unknown): obj is IAttachment {
  return typeof obj === 'object' && obj !== null && 'id' in obj;
}
