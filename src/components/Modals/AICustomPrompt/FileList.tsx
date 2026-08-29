"use client"

import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1"
import { IAttachment } from "@/models/model"
import formatDateDifference from "@/utils/generateTime"
import { formatFileSize } from "@/utils/helperFunctions/multiPages"
import { File, FileCode2, FileSpreadsheet, FileText, Image, Trash2 } from "lucide-react";

interface FileListProps {
  files: IAttachment[]
  onRemove: (fileId: string | number) => void;
  deletingFileIds: number[]
}

export function FileList({ files, onRemove, deletingFileIds }: FileListProps) {
  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith("image/")) return <Image strokeWidth={1.75} className="h-5 w-5 text-blue-500" />
    if (fileType.includes("pdf")) return <FileText strokeWidth={1.75} className="h-5 w-5 text-red-500" />
    if (fileType.includes("spreadsheet") || fileType.includes("excel") || fileType.includes("csv"))
      return <FileSpreadsheet strokeWidth={1.75} className="h-5 w-5 text-green-500" />
    if (fileType.includes("document") || fileType.includes("word"))
      return <FileText strokeWidth={1.75} className="h-5 w-5 text-blue-700" />
    if (fileType.includes("code") || fileType.includes("json") || fileType.includes("html"))
      return <FileCode2 strokeWidth={1.75} className="h-5 w-5 text-purple-500" />
    return <File strokeWidth={1.75} className="h-5 w-5 text-gray-500" />
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  }

  return (
    <div className="space-y-2">
      {files.map((file) => {
        const isDeleting = deletingFileIds.includes(file.id);
        return (
          <>
            <div
              key={file.id}
              className="flex border-2 border-gray-600 border-opacity-45 items-center justify-between p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              {file.fileSource ? (
                <a
                  className="group flex cursor-pointer items-center space-x-3"
                  download={file.fileName}
                  href={file.fileSource}
                  rel="noreferrer"
                  target="_blank"
                >
                  {getFileIcon(file.fileType)}
                  <div>
                    <p className="max-w-[200px] truncate text-content font-medium group-hover:underline sm:max-w-[300px]">
                      {file.fileName}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {formatFileSize(Number(file.fileSize))} • {formatDateDifference(file.createdAt.toString())}
                    </p>
                  </div>
                </a>
              ) : (
                <div className="flex items-center space-x-3">
                  {getFileIcon(file.fileType)}
                  <div>
                    <p className="max-w-[200px] truncate text-content font-medium sm:max-w-[300px]">
                      {file.fileName}
                    </p>
                    <p className="text-meta text-muted-foreground">
                      {formatFileSize(Number(file.fileSize))} • {formatDateDifference(file.createdAt.toString())}
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={() => onRemove(file.id)}
                className="text-muted-foreground text-content hover:text-red-400"
                title="Remove file"
              >
                {
                  isDeleting ? 
                                    
                  <div role="status">
                      <svg aria-hidden="true" className="w-4 h-4 text-gray-200 animate-spin dark:text-gray-600 fill-red-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                          <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
                      </svg>
                  </div>

                  :
                  <Trash2 strokeWidth={1.75} className="h-4 w-4" />
                }
              </button>
            </div>
          </>
        )
      })}

    </div>
  )
}
