import { useCallback, useState, useEffect, useRef } from "react";
import AILogo from "@/assets/AILogo.png";
import { useAITaskWriterContext } from "@/lib/contexts/TaskDetail/AITaskWriterContext";
import { aiTaskWriterConfig } from "@/lib/configs/aiTaskWriter.config";
import ImageGallery from "@/components/Common/AttachmentsUpload/ImageGalleryView";
import { useSkillSlashMenu } from "./useSkillSlashMenu";

interface AITaskWriterInputAreaProps {
  isLoading: boolean;
  autoTrigger: boolean;
  currentDisplayResponse: string;
  loadingText: string;
  userPrompt: string;
  setUserPrompt: any;
  returnUserInputHandler?: (value: string) => void;
  handleInputKeydown: (e: React.KeyboardEvent) => void;
  onClickHandler: () => void;
  textAreaRef: React.RefObject<HTMLTextAreaElement | null>;
  aiMode?: any;
  isMobile?: boolean;
  isUploadingAttachments?: boolean;
  uploadProgress?: {
    uploaded: number;
    total: number;
  };

  toggleRecording?: (val: boolean) => void;
}

const  AITaskWriterInputArea: React.FC<AITaskWriterInputAreaProps> = ({
  isLoading,
  autoTrigger,
  currentDisplayResponse,
  loadingText,
  userPrompt,
  setUserPrompt,
  returnUserInputHandler,
  handleInputKeydown,
  onClickHandler,
  textAreaRef,
  aiMode,
  isMobile = false,
  isUploadingAttachments = false,
  uploadProgress = { uploaded: 0, total: 0 },
  toggleRecording,
}) => {
  // Get all file upload functionality from context
  const { 
    attachments, 
    addAttachment, 
    removeAttachment,
    updateAttachmentWithS3Url,
    fileItems,
    files,
    fileInputRef,
    triggerFileInput,
    handleFileUpload: contextHandleFileUpload,
    handleDroppedFiles,
    removeFile,
    clearFiles
  } = useAITaskWriterContext();
  
  const [isDragOver, setIsDragOver] = useState(false);

  // "/" skill picker (parity with AI chat). Reproduced for the textarea.
  const skillMenu = useSkillSlashMenu({
    textAreaRef,
    setValue: setUserPrompt,
    returnUserInputHandler,
  });
  // Whether the menu consumed the last keydown, so onKeyUp knows not to re-detect
  // on keys the menu already handled (which would reset the highlight or reopen).
  const menuConsumedKeyRef = useRef(false);

  // Supported file types (only images, PDFs, and DOCX)
  const supportedTypes = [
    'image/*',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  const isFileSupported = (file: File) => {
    return file.type.startsWith('image/') || 
           file.type === 'application/pdf' ||
           file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
           file.name.toLowerCase().endsWith('.docx');
  };

  // Custom file handler with validation
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Filter for supported files only
    const fileArray = Array.from(files);
    const supportedFiles = fileArray.filter(file => isFileSupported(file));
    
    if (supportedFiles.length !== fileArray.length) {
      // Show warning for unsupported files
      console.warn("Some files were skipped. Only images, PDF, and DOCX files are supported.");
    }

    // Call the context handler with supported files only
    if (supportedFiles.length > 0) {
      const supportedFileList = new DataTransfer();
      supportedFiles.forEach(file => supportedFileList.items.add(file));
      
      const newEvent = {
        ...e,
        target: {
          ...e.target,
          files: supportedFileList.files
        }
      };
      
      contextHandleFileUpload(newEvent as React.ChangeEvent<HTMLInputElement>);
    }
  }, [contextHandleFileUpload]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl/Cmd + Shift + A
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (!isLoading) {
          triggerFileInput();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, triggerFileInput]);

  // Handle file paste
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const supportedItems = items.filter(item => {
      const file = item.getAsFile();
      return file && isFileSupported(file);
    });

    if (supportedItems.length > 0) {
      e.preventDefault();
      const pastedFiles = supportedItems
        .map(item => {
          const file = item.getAsFile();
          if (!file) return null;
          
          // Generate a proper filename for pasted files
          const timestamp = Date.now();
          const fileExtension = file.type.split('/')[1] || 'png';
          const filename = `${timestamp}.${fileExtension}`;
          
          // Create a new File object with the proper name
          return new File([file], filename, { type: file.type });
        })
        .filter((file): file is File => file !== null);
      
      handleDroppedFiles(pastedFiles);
    }
  }, [handleDroppedFiles]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const supportedFiles = files.filter(file => isFileSupported(file));
    
    if (supportedFiles.length > 0) {
      handleDroppedFiles(supportedFiles);
    }
  }, [handleDroppedFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only set drag over to false if we're leaving the container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // When the skill menu is open it consumes Enter/Tab/Arrows/Escape so they
    // don't also submit the prompt or move the caret.
    const consumed = skillMenu.onKeyDown(e);
    menuConsumedKeyRef.current = consumed;
    if (consumed) return;
    handleInputKeydown(e);
    // Handle paste keyboard shortcut
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      // Paste event will be handled by onPaste
    }
  }, [handleInputKeydown, skillMenu]);

  // Handle uploaded attachments callback
  const handleUploadedAttachments = useCallback(async (uploadedAttachments: any[]) => {
    // Update existing attachments with their S3 URLs
    console.log("Uploaded attachments:", uploadedAttachments);
    
    uploadedAttachments.forEach(attachment => {
      // Extract the S3 URL from the uploaded attachment
      const s3Url = attachment.file?.source || attachment.url;
      const fileName = attachment.file?.name;
      
      if (fileName && s3Url) {
        console.log("🚀 ~ Updating attachment with S3 URL:", fileName, s3Url);
        updateAttachmentWithS3Url(fileName, s3Url);
      }
    });
  }, [updateAttachmentWithS3Url]);

  const handleRemove = useCallback((name: string) => {
    console.log("🚀 ~ handleRemove ~ name:", name);
    removeFile(name);
    removeAttachment(name);
  }, [removeFile, removeAttachment]);

  return (
    <div 
      style={{fontSize:aiTaskWriterConfig.fontSizes.input}}
      className="transition-opacity duration-150 ease-in-out">
      {isLoading || (autoTrigger && !currentDisplayResponse) ? (
        <span className="flex items-center gap-2 animate-fadeIn">
          <img
            className="mt-[2px]"
            height={20}
            width={16}
            src={AILogo.src}
            alt="ai"
          />
          <span>{loadingText}</span>
        </span>
      ) : (
        <div 
          className={`relative w-full animate-fadeIn ${isDragOver ? 'bg-hypertasks-ai-purple bg-opacity-10 border-2 border-dashed border-hypertasks-ai-purple rounded-md' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="relative flex gap-2 w-full">
            <textarea
              id="htc"
              ref={textAreaRef}
              onKeyDown={handleKeyDown}
              onKeyUp={e => {
                // The menu already handled this key (Arrows to navigate, Enter/
                // Tab to pick, Escape to dismiss) — re-detecting would reset the
                // highlight or reopen right after Escape.
                if (menuConsumedKeyRef.current) return;
                // Otherwise re-sync only on caret-moving keys (typing is covered
                // by onChange). This lets an Arrow move the caret onto a "/slug"
                // line and reopen the menu when it wasn't open.
                if (
                  ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)
                ) {
                  skillMenu.onCaretMove();
                }
              }}
              onClick={skillMenu.onCaretMove}
              onBlur={() => requestAnimationFrame(skillMenu.close)}
              onPaste={handlePaste}
              disabled={isLoading}
              autoFocus
              value={userPrompt}
              onChange={e => {
                setUserPrompt(e.target.value);
                returnUserInputHandler?.(e.target.value);
                skillMenu.onInput(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length
                );
              }}
              placeholder={
                aiMode === "AiTaskWriter"
                  ? "What is this task about? You can attach files or paste images..."
                  : "What do you want to write about? You can attach files or paste images..."
              }
              // No visible scrollbar: the wrapping placeholder used to overflow
              // the box and summon one. Placeholder truncates to a single line
              // instead; typed content still scrolls with the caret. HTPR-4571.
              className={
                isMobile
                  ? "min-h-[52px] resize-none border-none bg-inherit py-3 text-[16px] leading-6 outline-none w-full caret-hypertasks-ai-purple scrollbar-none placeholder:truncate"
                  : "resize-none outline-none bg-inherit w-full py-2 border-none scrollbar-none placeholder:truncate"
              }
            />
            
            {/* Hidden file input - managed by the hook */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={supportedTypes.join(',')}
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>

          {skillMenu.menu}

          {/* Replace AITaskWriterAttachments with ImageGallery */}
          {fileItems.length > 0 && (
            <div className="bg-comment-description rounded-md p-2">
              <ImageGallery
                files={fileItems}
                images={[]}
                allowDelete={true}
                shouldUpload={true}
                handleRemove={handleRemove}
                mode="Creating task"
                callbackAttachments={handleUploadedAttachments}
              />
              
              {/* Upload progress indicator */}
              {isUploadingAttachments && uploadProgress.total > 0 && (
                <div className="mt-2 text-meta text-icon-dark-gray flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-hypertasks-ai-purple border-t-transparent rounded-full animate-spin" />
                  <span>Uploading {uploadProgress.uploaded}/{uploadProgress.total} attachments...</span>
                </div>
              )}
            </div>
          )}
          
          {/* Drag overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-hypertasks-ai-purple bg-opacity-20 rounded-md pointer-events-none">
              <div className="text-hypertasks-ai-purple font-medium text-center">
                <div>Drop files here to attach</div>
                <div className="font-normal opacity-80">Images, PDF, DOCX (Max 2MB each)</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AITaskWriterInputArea;
