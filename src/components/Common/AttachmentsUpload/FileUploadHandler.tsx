import React, { useRef, useState, useEffect, ChangeEvent } from "react";
import { processFiles } from "@/utils/helperFunctions/helperFunctions";

export interface FileItem {
  id: number;
  file: File;
}

// Hook version for more flexibility
export const useFileUpload = (initialFiles: FileItem[] = []) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileItems, setFileItems] = useState<FileItem[]>(initialFiles);

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const startingId = fileItems.length;
    const uniqueFiles = Array.from(files).filter(
      (newFile) =>
        !fileItems.some(
          (existingFile) =>
            existingFile.file.name === newFile.name &&
            existingFile.file.size === newFile.size
        )
    );

    if (uniqueFiles.length > 0) {
      const newFileItems = await processFiles(
        uniqueFiles as unknown as FileList,
        startingId
      );
      setFileItems((prevItems) => [...prevItems, ...newFileItems]);
    }
  };

  const handleDroppedFiles = async (files: File[]) => {
    const startingId = fileItems.length;
    const uniqueFiles = Array.from(files).filter(
      (newFile) =>
        !fileItems.some(
          (existingFile) =>
            existingFile.file.name === newFile.name &&
            existingFile.file.size === newFile.size
        )
    );

    if (uniqueFiles.length > 0) {
      const newFileItems = await processFiles(
        uniqueFiles as unknown as FileList,
        startingId
      );
      setFileItems((prevItems) => [...prevItems, ...newFileItems]);
    }
  };

  const removeFile = (name: string) => {
    setFileItems((prevItems) =>
      prevItems.filter((item) => item.file.name !== name)
    );
  };

  const clearFiles = () => {
    setFileItems([]);
  };

  const resetFiles = (newFiles: FileItem[] = []) => {
    setFileItems(newFiles);
  };
    const handleAttachmentClick = (e?: any) => {
    e?.stopPropagation();
    fileInputRef?.current?.click();
  };


  return {
    fileItems,
    files: fileItems.map(item => item.file),
    fileInputRef,
    triggerFileInput,
    handleFileUpload,
    handleDroppedFiles,
    removeFile,
    clearFiles,
    resetFiles,
    setFileItems,
    handleAttachmentClick
  };
};