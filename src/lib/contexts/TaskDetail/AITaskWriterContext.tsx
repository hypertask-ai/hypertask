import React, { createContext, useContext, useState, useCallback, useRef, ReactNode, useEffect } from "react";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { currentProjectAtom, uploadingStateCreateTaskModalAtom, type CurrentBoardBilling } from "@/store";
import { TAiMode, TAiModal } from "@/models/AI_Task_writer_model";
import { aiOptions } from "@/lib/constants/constants";
import useAITaskWriter from "@/hooks/MultiPages/AiWriter/useAiTaskWriter";
import { ITask } from "@/models/model";
import { processFiles } from "@/utils/helperFunctions/helperFunctions";
import { useCurrentBoardBilling } from "@/hooks/General/useCurrentBoardBilling";
import { shouldBlockAiDueToByokProvider } from "@/lib/byokSelectedProviderGate";
import { useAiModelPreference } from "@/hooks/General/useAiModelPreference";
import type { IProject } from "@/models/model";
import { resolveTaskWriterBoardContext } from "@/lib/ai/taskWriterBoardContext";


export interface FileItem {
  id: number;
  file: File;
}

interface IAIAttachment {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'pdf' | 'docx';
}

interface IAIResponseHistoryItem {
  id: string;
  userPrompt: string;
  aiResponse: string;
  mode: TAiMode;
  timestamp: Date;
  options?: string;
  attachments?: IAIAttachment[];
}

interface AITaskWriterContextType {
  aiMode: TAiMode;
  userPrompt: string;
  setUserPrompt: any;

  displayAiOptions: TAiModal[];
  currentAiOption: TAiModal;

  fileItems: FileItem[];
  files: File[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  triggerFileInput: () => void;
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDroppedFiles: (files: File[]) => Promise<void>;
  removeFile: (name: string) => void;
  clearFiles: () => void;
  resetFiles: (newFiles?: FileItem[]) => void;
  setFileItems: React.Dispatch<React.SetStateAction<FileItem[]>>;
  handleAttachmentClick: (e?: any) => void;

  attachments: IAIAttachment[];
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  updateAttachmentWithS3Url: (fileName: string, s3Url: string) => void;

  isUploadingAttachments: boolean;
  uploadProgress: {
    uploaded: number;
    total: number;
  };

  responseHistory: IAIResponseHistoryItem[];
  currentResponseIndex: number;
  currentDisplayResponse: string;
  getCurrentResponseItem: () => IAIResponseHistoryItem | null;
  setCurrentResponseIndex: (index: number) => void;

  isLoading: boolean;
  loadingText: string;
  setLoadingText: (text: string) => void;
  hasError: boolean;

  sendAIRequest: (
    prompt: string,
    loadingText?: string,
    requestKind?: "manual" | "auto-description",
    options?: { userRetrievalTexts?: string[] },
  ) => Promise<void>;
  retryLastRequest: () => Promise<void>;
  navigateResponse: (index: number) => void;
  clearHistory: () => void;

  dropDownButtonAICallback: (selected: TAiModal) => void;

  isByokBlocked: boolean;
  modelTeamId: string | null;
  modelBilling: CurrentBoardBilling | null;
  projectId: number | null;
}

interface AITaskWriterProviderProps {
  children: ReactNode;
  defaultMode?: TAiMode;
  additionalContext?: string;
  attachments?: any[];
  description?: string;
  currentTask?: ITask;
  projectLabels?: import("@/models/model").ILabel[];
  projectSections?: { id?: number; section_title?: string }[];
  projectAssignees?: (import("@/models/model").IUser | import("@/models/model").IAgent)[];
  project?: IProject;
  requestKind?: "manual" | "auto-description";
}


const AITaskWriterContext = createContext<AITaskWriterContextType | undefined>(undefined);


const MAX_FILE_SIZE = 2 * 1024 * 1024;

const CONTEXT_HISTORY_LIMIT = 3;


export const AITaskWriterProvider: React.FC<AITaskWriterProviderProps> = ({
  children,
  defaultMode = "WriteWithAI",
  additionalContext,
  attachments: initialAttachments,
  description,
  currentTask,
  projectLabels,
  projectSections,
  projectAssignees,
  project,
  requestKind = "manual",
}) => {
  const [aiMode] = useState<TAiMode>(defaultMode);
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [openProject] = useRecoilState(currentProjectAtom);

  const prevProjectIdRef = useRef<string | number | undefined>(undefined);

  const uploadState = useRecoilValue(uploadingStateCreateTaskModalAtom);

  
  const [currentPromptForHistory, setCurrentPromptForHistory] = useState("");
  
  const [attachmentsForHistory, setAttachmentsForHistory] = useState<IAIAttachment[]>([]);
  
  const [originalPromptForRestore, setOriginalPromptForRestore] = useState("");
  
  const [originalAttachmentsForRestore, setOriginalAttachmentsForRestore] = useState<IAIAttachment[]>([]);

  
  const [currentAttachments, setCurrentAttachments] = useState<IAIAttachment[]>([]);
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [processedImages, setProcessedImages] = useState<any[]>([]);
  const [processedPDFs, setProcessedPDFs] = useState<any[]>([]);
  const [processedDOCX, setProcessedDOCX] = useState<any[]>([]);

  
  const [displayAiOptions, setDisplayAiOptions] = useState<TAiModal[]>(aiOptions);
  
  const boardBilling = useCurrentBoardBilling();
  const {
    project: currentProject,
    billing,
    teamId: modelTeamId,
    boardDefaultId,
  } = resolveTaskWriterBoardContext({
    destinationProject: project,
    openProject,
    openBilling: boardBilling,
  });
  const { currentAiOption, setAiOption } = useAiModelPreference(
    defaultMode === "AiTaskWriter" ? "taskWriter" : "writeWithAi",
    {
      teamId: modelTeamId,
      billing,
      boardDefaultId,
    },
  );
  const isByokBlocked = shouldBlockAiDueToByokProvider(billing, currentAiOption?.source);

  const [responseHistory, setResponseHistory] = useState<IAIResponseHistoryItem[]>([]);
  const [currentResponseIndex, setCurrentResponseIndex] = useState(-1);


  useEffect(() => {
    const currentProjectId = currentProject?.id;
    if (prevProjectIdRef.current === undefined) {
      prevProjectIdRef.current = currentProjectId;
      return;
    }
    if (prevProjectIdRef.current !== currentProjectId) {
      prevProjectIdRef.current = currentProjectId;
      setResponseHistory([]);
      setCurrentResponseIndex(-1);
      setAttachmentsForHistory([]);
      setCurrentPromptForHistory("");
      setOriginalPromptForRestore("");
      setOriginalAttachmentsForRestore([]);
      setProcessedImages([]);
      setProcessedPDFs([]);
      setProcessedDOCX([]);
      setFileItems([]);
    }
  }, [currentProject?.id]);


  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [fileItems]);

  const handleDroppedFiles = useCallback(async (files: File[]) => {
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
  }, [fileItems]);

  const removeFile = useCallback((name: string) => {
    setFileItems((prevItems) =>
      prevItems.filter((item) => item.file.name !== name)
    );
  }, []);

  const clearFiles = useCallback(() => {
    setFileItems([]);
  }, []);

  const resetFiles = useCallback((newFiles: FileItem[] = []) => {
    setFileItems(newFiles);
  }, []);

  const handleAttachmentClick = useCallback((e?: any) => {
    e?.stopPropagation();
    fileInputRef?.current?.click();
  }, []);

  const files = React.useMemo(() => fileItems.map(item => item.file), [fileItems]);


  const addAttachment = useCallback((UploadedFileObject: any) => {
    const { file } = UploadedFileObject;
    
    if (file.size > MAX_FILE_SIZE) {
      alert(`File "${file.name}" is too large. Maximum size is 2MB.`);
      return;
    }

    const fileExists = fileItems.some(item =>
      item.file.name === file.name && item.file.size === file.size
    );

    if (fileExists) {
      console.warn(`File "${file.name}" already exists`);
      return;
    }

    let fileType: 'image' | 'pdf' | 'docx';
    if (file.type.startsWith('image/')) {
      fileType = 'image';
    } else if (file.type === 'application/pdf') {
      fileType = 'pdf';
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.toLowerCase().endsWith('.docx')) {
      fileType = 'docx';
    } else {
      alert(`File type "${file.type}" is not supported. Only images, PDFs, and DOCX files are allowed.`);
      return;
    }

    const newFileItem: FileItem = {
      id: fileItems.length,
      file
    };
    setFileItems(prev => [...prev, newFileItem]);
  }, [fileItems]);

  const removeAttachment = useCallback((id: string) => {
    const attachment = currentAttachments.find(att => att.id === id);
    if (attachment) {
      removeFile(attachment.file.name);
    }
  }, [currentAttachments, removeFile]);

  const clearAttachments = useCallback(() => {
    clearFiles();
  }, [clearFiles]);

  const updateAttachmentWithS3Url = useCallback((fileName: string, s3Url: string) => {
    setCurrentAttachments(prev => 
      prev.map(att => 
        att.file.name === fileName 
          ? { ...att, preview: s3Url } 
          : att
      )
    );
  }, []);


  useEffect(() => {
    const syncedAttachments = fileItems.map(fileItem => {
      const file = fileItem.file;
      const id = `${fileItem.id}-${file.name}`;

      let fileType: 'image' | 'pdf' | 'docx';
      if (file.type.startsWith('image/')) {
        fileType = 'image';
      } else if (file.type === 'application/pdf') {
        fileType = 'pdf';
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.toLowerCase().endsWith('.docx')) {
        fileType = 'docx';
      } else {
        fileType = 'image';
      }

      return {
        id,
        file,
        preview: URL.createObjectURL(file),
        type: fileType
      };
    });

    setCurrentAttachments(syncedAttachments);
  }, [fileItems]);


  useEffect(() => {
    const processAttachments = async () => {
      if (currentAttachments.length === 0) {
        setProcessedImages([]);
        setProcessedPDFs([]);
        setProcessedDOCX([]);
        return;
      }

      try {
        const images: any[] = [];
        const pdfs: any[] = [];
        const docx: any[] = [];

        await Promise.all(
          currentAttachments.map(async (attachment) => {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(attachment.file);
            });

            const base64Url = await base64Promise;

            const processedFile = {
              fileName: attachment.file.name,
              url: base64Url,
              mimeType: attachment.file.type,
              type: attachment.file.type,
              source: base64Url,
              name: attachment.file.name,
              size: attachment.file.size
            };

            switch (attachment.type) {
              case 'image':
                images.push(processedFile);
                break;
              case 'pdf':
                pdfs.push(processedFile);
                break;
              case 'docx':
                docx.push(processedFile);
                break;
            }
          })
        );

        setProcessedImages(images);
        setProcessedPDFs(pdfs);
        setProcessedDOCX(docx);
      } catch (error) {
        console.error('Error processing attachments:', error);
        setProcessedImages([]);
        setProcessedPDFs([]);
        setProcessedDOCX([]);
      }
    };

    processAttachments();
  }, [currentAttachments]);


  const combinedAttachments = React.useMemo(() => {
    const combined = [...processedImages, ...processedPDFs, ...processedDOCX];
    return combined.length > 0 ? combined : initialAttachments;
  }, [processedImages, processedPDFs, processedDOCX, initialAttachments]);


  const isUploadingAttachments = React.useMemo(() => {
    return uploadState ? !uploadState.canUpload : false;
  }, [uploadState]);

  const uploadProgress = React.useMemo(() => {
    return {
      uploaded: uploadState?.uploaded ?? 0,
      total: uploadState?.attached ?? 0
    };
  }, [uploadState]);


  const effectiveAdditionalContext = React.useMemo(() => {
    const parts: string[] = [];
    if (aiMode === "AiTaskWriter") {
      parts.push(
        `Output format: Use HTML elements with these IDs for structured data (omit if not specified):
- h1#ai-generated-task-title: task title
- span#ai-generated-task-priority: priority_index 0-4 (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
- span#ai-generated-task-estimate: estimate_index 0-7 (0=None, 2=XS, 3=S, 4=M, 5=L, 6=XL)
- span#ai-generated-task-tags: comma-separated label IDs that clearly apply to this task based on its content. Be conservative: include a tag only when you are confident it genuinely fits, omit anything only loosely or topically related, and prefer fewer high-confidence tags. Usually one or two is enough; rarely more than three. When unsure about a tag, leave it off.
- span#ai-generated-task-status: section_id (number) when user specifies status/column
- span#ai-generated-task-assignees: comma-separated assignee IDs only when the user clearly names an available assignee
- span#ai-generated-task-due-date: due date as YYYY-MM-DD only when the user specifies one
- span#ai-generated-task-start-date: start date as YYYY-MM-DD only when the user specifies one
- Put every inferred property into ONE combined "Proposed properties: ..." paragraph that is the LAST element of the entire output (e.g. <p>Proposed properties: Priority <strong>High</strong>, Size <strong>S</strong><span id="ai-generated-task-priority" style="display:none">2</span><span id="ai-generated-task-estimate" style="display:none">3</span></p>). Never print a property line anywhere else in the body.`
      );
      if (projectLabels && projectLabels.length > 0) {
        const labelsStr = projectLabels
          .map((l) => `{id: "${l.id}", value: "${l.value ?? ""}"}`)
          .join(", ");
        parts.push(
          `Available tags for this project (use these exact IDs in ai-generated-task-tags). Choose only the few that clearly apply to this task; this is a menu to pick sparingly from, not a checklist to fill: [${labelsStr}]`
        );
      }
      if (projectSections && projectSections.length > 0) {
        const sectionsStr = projectSections
          .map((s) => `{id: ${s.id}, section_title: "${s.section_title ?? ""}"}`)
          .join(", ");
        parts.push(
          `Available status/columns for this project (use these exact id values in ai-generated-task-status): [${sectionsStr}]`
        );
      }
      if (projectAssignees && projectAssignees.length > 0) {
        const assignees = projectAssignees.map((assignee) => ({
          id: assignee.id,
          displayName: assignee.displayName ?? "",
        }));
        parts.push(
          `Available assignees for this project (use these exact id values in ai-generated-task-assignees): ${JSON.stringify(assignees)}`
        );
      }
    }
    if (additionalContext) parts.push(additionalContext);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }, [
    aiMode,
    projectLabels,
    projectSections,
    projectAssignees,
    additionalContext,
  ]);


  const { 
    isLoading, 
    aiResponse, 
    loadingText, 
    setLoadingText, 
    sendAIRequest: originalSendAIRequest, 
    retryLastRequest: originalRetryLastRequest,
    restoreMedia,
    hasError 
  } = useAITaskWriter(
    currentProject,
    currentAiOption,
    aiMode,
    effectiveAdditionalContext,
    combinedAttachments,
    description,
    currentTask,
    billing,
    requestKind,
  );


  const restoredAiResponse = React.useMemo(
    () => restoreMedia(aiResponse, !isLoading),
    [aiResponse, isLoading, restoreMedia]
  );

  const currentDisplayResponse = React.useMemo(() => {
    if (isLoading) {
      return restoredAiResponse;
    }

    if (currentResponseIndex >= 0 && currentResponseIndex < responseHistory.length && responseHistory[currentResponseIndex]) {
      return responseHistory[currentResponseIndex].aiResponse;
    }

    return restoredAiResponse;
  }, [currentResponseIndex, responseHistory, restoredAiResponse, isLoading]);

  const getCurrentResponseItem = React.useMemo(() => {
    if (currentResponseIndex >= 0 && currentResponseIndex < responseHistory.length) {
      return responseHistory[currentResponseIndex];
    }
    return null;
  }, [currentResponseIndex, responseHistory]);


  const sendAIRequest = useCallback(async (
    prompt: string,
    loadingTextParam = "Thinking...",
    requestKindOverride?: "manual" | "auto-description",
  ) => {
    const requestAttachments = currentAttachments;
    
    const attachmentsForPersistentStorage = await Promise.all(
      requestAttachments.map(async (attachment) => {
        let persistentPreview = attachment.preview;

        if (attachment.preview.startsWith('blob:')) {
          try {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(attachment.file);
            });
            persistentPreview = await base64Promise;
          } catch (error) {
            console.error('Error converting blob to base64:', error);
          }
        }

        return {
          ...attachment,
          preview: persistentPreview
        };
      })
    );

    const originalPrompt = prompt;

    if (isByokBlocked) return;

    setLoadingText(loadingTextParam);
    setUserPrompt("");
    setCurrentPromptForHistory(prompt);
    setAttachmentsForHistory(attachmentsForPersistentStorage);

    setOriginalPromptForRestore(originalPrompt);
    setOriginalAttachmentsForRestore(requestAttachments);

    setCurrentResponseIndex(responseHistory.length);

    let finalPrompt = prompt;
    if (responseHistory.length > 0) {
      const recentHistory = responseHistory.slice(-CONTEXT_HISTORY_LIMIT);
      const contextString = recentHistory
        .map((item, index) => {
          const exchangeNum = responseHistory.length - recentHistory.length + index + 1;
          const attachmentInfo = item.attachments && item.attachments.length > 0
            ? `\n[${item.attachments.length} image(s) attached]`
            : '';
          return `[Exchange ${exchangeNum}]
                User Input: ${item.userPrompt}${attachmentInfo}
                AI Response: ${item.aiResponse}`;
        })
        .join('\n\n');

      const contextResponse = currentResponseIndex >= 0
        ? responseHistory[currentResponseIndex].aiResponse
        : aiResponse;

      const currentExchangeNum = currentResponseIndex >= 0
        ? currentResponseIndex + 1
        : responseHistory.length;

      const currentAttachmentInfo = requestAttachments.length > 0
        ? `\n[${requestAttachments.length} image(s) attached]`
        : '';

      finalPrompt = `CONVERSATION HISTORY:
        ${contextString}

        CURRENT ACTIVE RESPONSE [Exchange ${currentExchangeNum}]:
        ${contextResponse}

        NEW USER REQUEST [Exchange ${responseHistory.length + 1}]:
        ${prompt}${currentAttachmentInfo}`;
    }

    const userRetrievalTexts = [
      ...responseHistory.map((item) => item.userPrompt),
      prompt,
    ].filter((text) => Boolean(text?.trim()));

    await originalSendAIRequest(
      finalPrompt,
      loadingTextParam,
      requestKindOverride,
      { userRetrievalTexts },
    );
  }, [originalSendAIRequest, responseHistory, currentResponseIndex, aiResponse, setLoadingText, currentAttachments, isByokBlocked]);

  const retryLastRequest = useCallback(async () => {
    if (isByokBlocked || !currentPromptForHistory) return;

    setOriginalPromptForRestore(currentPromptForHistory);
    setOriginalAttachmentsForRestore(currentAttachments);
    setUserPrompt("");
    setCurrentResponseIndex(responseHistory.length);

    await originalRetryLastRequest();
  }, [
    currentAttachments,
    currentPromptForHistory,
    isByokBlocked,
    originalRetryLastRequest,
    responseHistory.length,
  ]);


  useEffect(() => {
    if (!isLoading && originalPromptForRestore && hasError) {
      setUserPrompt(originalPromptForRestore);
      setCurrentAttachments(originalAttachmentsForRestore);

      setOriginalPromptForRestore("");
      setOriginalAttachmentsForRestore([]);
    }
  }, [aiResponse, isLoading, hasError, originalPromptForRestore, originalAttachmentsForRestore]);


  useEffect(() => {
    if (aiResponse && !isLoading && !hasError && currentPromptForHistory) {
      setResponseHistory(prev => {
        const historyItem: IAIResponseHistoryItem = {
          id: Date.now().toString(),
          userPrompt: currentPromptForHistory,
          aiResponse: restoredAiResponse,
          mode: aiMode,
          timestamp: new Date(),
          attachments: attachmentsForHistory.length > 0 ? [...attachmentsForHistory] : undefined,
        };
        const newHistory = [...prev, historyItem];
        
        setCurrentResponseIndex(newHistory.length - 1);
        return newHistory;
      });
      
      setCurrentPromptForHistory("");
      setAttachmentsForHistory([]);
      setOriginalPromptForRestore("");
      setOriginalAttachmentsForRestore([]);
      clearAttachments();
    }
  }, [aiResponse, restoredAiResponse, isLoading, currentPromptForHistory, aiMode, attachmentsForHistory, clearAttachments, hasError, responseHistory.length]);


  const navigateResponse = useCallback((index: number) => {
    if (responseHistory.length === 0) {
      setCurrentResponseIndex(-1);
      return;
    }

    if (index < 0) {
      setCurrentResponseIndex(0);
    } else if (index >= responseHistory.length) {
      setCurrentResponseIndex(responseHistory.length - 1);
    } else {
      setCurrentResponseIndex(index);
    }
  }, [responseHistory.length]);

  const clearHistory = useCallback(() => {
    setResponseHistory([]);
    setCurrentResponseIndex(-1);
    setUserPrompt("");
    clearAttachments();
  }, [clearAttachments]);


  const dropDownButtonAICallback = useCallback((selected: TAiModal) => {
    const item = aiOptions.find(option => selected.id === option.id);
    if (item) {
      setAiOption(item);
      setDisplayAiOptions([item, ...aiOptions.filter(option => option.id !== item.id)]);
    }
  }, [setAiOption]);


  const contextValue: AITaskWriterContextType = {
    aiMode,
    userPrompt,
    setUserPrompt,

    displayAiOptions,
    currentAiOption,

    fileItems,
    files,
    fileInputRef,
    triggerFileInput,
    handleFileUpload,
    handleDroppedFiles,
    removeFile,
    clearFiles,
    resetFiles,
    setFileItems,
    handleAttachmentClick,

    attachments: currentAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    updateAttachmentWithS3Url,

    isUploadingAttachments,
    uploadProgress,

    responseHistory,
    currentResponseIndex,
    currentDisplayResponse,
    getCurrentResponseItem: () => getCurrentResponseItem,
    setCurrentResponseIndex,

    isLoading,
    loadingText,
    setLoadingText,
    hasError,

    sendAIRequest,
    retryLastRequest,
    navigateResponse,
    clearHistory,

    dropDownButtonAICallback,

    isByokBlocked,
    modelTeamId: modelTeamId ? String(modelTeamId) : null,
    modelBilling: billing,
    projectId: currentProject?.id ?? null,
  };

  return (
    <AITaskWriterContext.Provider value={contextValue}>
      {children}
    </AITaskWriterContext.Provider>
  );
};


export const useAITaskWriterContext = () => {
  const context = useContext(AITaskWriterContext);
  if (context === undefined) {
    throw new Error('useAITaskWriterContext must be used within an AITaskWriterProvider');
  }
  return context;
};
