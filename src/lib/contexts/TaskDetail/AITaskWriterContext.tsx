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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Represents a file item with unique ID
 */
export interface FileItem {
  id: number;
  file: File;
}

/**
 * Represents an AI attachment with preview capability
 * Used for displaying uploaded files before sending to AI
 */
interface IAIAttachment {
  id: string;
  file: File;
  preview: string; // base64 or blob URL for preview
  type: 'image' | 'pdf' | 'docx';
}

/**
 * Represents a single exchange in the conversation history
 * Stores both user input and AI response with metadata
 */
interface IAIResponseHistoryItem {
  id: string;
  userPrompt: string;
  aiResponse: string;
  mode: TAiMode;
  timestamp: Date;
  options?: string;
  attachments?: IAIAttachment[];
}

/**
 * Main context interface exposing all AI Task Writer functionality
 */
interface AITaskWriterContextType {
  // Core state
  aiMode: TAiMode;
  userPrompt: string;
  setUserPrompt: any;

  // AI Options state
  displayAiOptions: TAiModal[];
  currentAiOption: TAiModal;

  // File Upload
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

  // Attachments (legacy support)
  attachments: IAIAttachment[];
  addAttachment: (file: File) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  updateAttachmentWithS3Url: (fileName: string, s3Url: string) => void;

  // Upload state tracking
  isUploadingAttachments: boolean;
  uploadProgress: {
    uploaded: number;
    total: number;
  };

  // Response history
  responseHistory: IAIResponseHistoryItem[];
  currentResponseIndex: number;
  currentDisplayResponse: string;
  getCurrentResponseItem: () => IAIResponseHistoryItem | null;
  setCurrentResponseIndex: (index: number) => void;

  // Loading states
  isLoading: boolean;
  loadingText: string;
  setLoadingText: (text: string) => void;
  hasError: boolean;

  // Core actions
  sendAIRequest: (
    prompt: string,
    loadingText?: string,
    requestKind?: "manual" | "auto-description",
  ) => Promise<void>;
  retryLastRequest: () => Promise<void>;
  navigateResponse: (index: number) => void;
  clearHistory: () => void;

  // Dropdown callbacks
  dropDownButtonAICallback: (selected: TAiModal) => void;

  // BYOK gate
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
  /** Project labels for Task Writer - injected into prompt so AI knows available tags (Task Writer only) */
  projectLabels?: import("@/models/model").ILabel[];
  /** Project sections/columns for Task Writer - injected into prompt so AI knows available statuses (Task Writer only) */
  projectSections?: { id?: number; section_title?: string }[];
  /** Assignable people/agents; only IDs and display names are sent to the model. */
  projectAssignees?: (import("@/models/model").IUser | import("@/models/model").IAgent)[];
  /** Destination board for global task creation. Defaults to the open board. */
  project?: IProject;
  requestKind?: "manual" | "auto-description";
}

// ============================================================================
// CONTEXT CREATION
// ============================================================================

const AITaskWriterContext = createContext<AITaskWriterContextType | undefined>(undefined);

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum file size allowed for attachments (2MB) */
const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** Number of recent exchanges to include in conversation context */
const CONTEXT_HISTORY_LIMIT = 3;

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * AITaskWriterProvider
 * 
 * Manages the complete state and functionality for the AI Task Writer feature.
 * Handles file uploads, conversation history, AI requests, and response navigation.
 * 
 * @param children - Child components that will have access to the context
 * @param defaultMode - Initial AI mode (WriteWithAI or AiTaskWriter)
 * @param additionalContext - Extra context to include with AI requests
 * @param attachments - Initial attachments to include
 * @param description - Task description for context
 * @param currentTask - Current task object for context
 */
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
  // --------------------------------------------------------------------------
  // STATE - Core AI Configuration
  // --------------------------------------------------------------------------
  
  // HTPR-3792: mode is locked to the surface (description = Task Writer,
  // comments = Write with AI); no in-UI switching, so aiMode is read-only.
  const [aiMode] = useState<TAiMode>(defaultMode);
  const [userPrompt, setUserPrompt] = useState<string>("");
  const [openProject] = useRecoilState(currentProjectAtom);

  // Ref to track if this is the initial mount (skip reset on first render)
  const prevProjectIdRef = useRef<string | number | undefined>(undefined);

  // Upload state tracking
  const uploadState = useRecoilValue(uploadingStateCreateTaskModalAtom);

  // --------------------------------------------------------------------------
  // STATE - History Tracking
  // --------------------------------------------------------------------------
  
  /** Stores the prompt for the current in-flight request */
  const [currentPromptForHistory, setCurrentPromptForHistory] = useState("");
  
  /** Stores attachments for the current in-flight request */
  const [attachmentsForHistory, setAttachmentsForHistory] = useState<IAIAttachment[]>([]);
  
  /** Stores original prompt for error recovery */
  const [originalPromptForRestore, setOriginalPromptForRestore] = useState("");
  
  /** Stores original attachments for error recovery */
  const [originalAttachmentsForRestore, setOriginalAttachmentsForRestore] = useState<IAIAttachment[]>([]);

  // --------------------------------------------------------------------------
  // STATE - Attachments & Files
  // --------------------------------------------------------------------------
  
  const [currentAttachments, setCurrentAttachments] = useState<IAIAttachment[]>([]);
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Processed file arrays by type
  const [processedImages, setProcessedImages] = useState<any[]>([]);
  const [processedPDFs, setProcessedPDFs] = useState<any[]>([]);
  const [processedDOCX, setProcessedDOCX] = useState<any[]>([]);

  // --------------------------------------------------------------------------
  // STATE - AI Options & Modes
  // --------------------------------------------------------------------------
  
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
  

  // --------------------------------------------------------------------------
  // STATE - Response History
  // --------------------------------------------------------------------------
  
  const [responseHistory, setResponseHistory] = useState<IAIResponseHistoryItem[]>([]);
  const [currentResponseIndex, setCurrentResponseIndex] = useState(-1);

  // --------------------------------------------------------------------------
  // EFFECT - Reset conversation history on project switch
  // --------------------------------------------------------------------------

  useEffect(() => {
    const currentProjectId = currentProject?.id;
    if (prevProjectIdRef.current === undefined) {
      // First mount: just record the id, don't wipe initial state
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

  // --------------------------------------------------------------------------
  // FILE UPLOAD METHODS
  // --------------------------------------------------------------------------

  /**
   * Triggers the hidden file input element
   */
  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handles file selection from file input
   * Filters out duplicates and processes valid files
   */
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

  /**
   * Handles files dropped via drag-and-drop
   * Filters out duplicates and processes valid files
   */
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

  /**
   * Removes a file by name from the file list
   */
  const removeFile = useCallback((name: string) => {
    setFileItems((prevItems) =>
      prevItems.filter((item) => item.file.name !== name)
    );
  }, []);

  /**
   * Clears all files from the list
   */
  const clearFiles = useCallback(() => {
    setFileItems([]);
  }, []);

  /**
   * Resets file list to new files or empty array
   */
  const resetFiles = useCallback((newFiles: FileItem[] = []) => {
    setFileItems(newFiles);
  }, []);

  /**
   * Handles attachment button click, triggering file input
   */
  const handleAttachmentClick = useCallback((e?: any) => {
    e?.stopPropagation();
    fileInputRef?.current?.click();
  }, []);

  /**
   * Computed array of File objects from fileItems
   */
  const files = React.useMemo(() => fileItems.map(item => item.file), [fileItems]);

  // --------------------------------------------------------------------------
  // ATTACHMENT METHODS (Legacy Support)
  // --------------------------------------------------------------------------

  /**
   * Adds a new attachment to the list
   * Validates file size and type before adding
   * Syncs with fileItems for backward compatibility
   */
  const addAttachment = useCallback((UploadedFileObject: any) => {
    const { file } = UploadedFileObject;
    
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File "${file.name}" is too large. Maximum size is 2MB.`);
      return;
    }

    // Check for duplicates
    const fileExists = fileItems.some(item =>
      item.file.name === file.name && item.file.size === file.size
    );

    if (fileExists) {
      console.warn(`File "${file.name}" already exists`);
      return;
    }

    // Validate file type
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

    // Add to fileItems (syncs to attachments via useEffect)
    const newFileItem: FileItem = {
      id: fileItems.length,
      file
    };
    setFileItems(prev => [...prev, newFileItem]);
  }, [fileItems]);

  /**
   * Removes an attachment by ID
   * Syncs removal with fileItems
   */
  const removeAttachment = useCallback((id: string) => {
    const attachment = currentAttachments.find(att => att.id === id);
    if (attachment) {
      removeFile(attachment.file.name);
    }
  }, [currentAttachments, removeFile]);

  /**
   * Clears all attachments
   */
  const clearAttachments = useCallback(() => {
    clearFiles();
  }, [clearFiles]);

  /**
   * Updates an existing attachment with its S3 URL after upload
   */
  const updateAttachmentWithS3Url = useCallback((fileName: string, s3Url: string) => {
    setCurrentAttachments(prev => 
      prev.map(att => 
        att.file.name === fileName 
          ? { ...att, preview: s3Url } 
          : att
      )
    );
  }, []);

  // --------------------------------------------------------------------------
  // EFFECT - Sync FileItems with Attachments
  // --------------------------------------------------------------------------

  /**
   * Synchronizes fileItems with attachment objects
   * Creates attachment objects with previews and type information
   */
  useEffect(() => {
    const syncedAttachments = fileItems.map(fileItem => {
      const file = fileItem.file;
      const id = `${fileItem.id}-${file.name}`;

      // Determine file type
      let fileType: 'image' | 'pdf' | 'docx';
      if (file.type.startsWith('image/')) {
        fileType = 'image';
      } else if (file.type === 'application/pdf') {
        fileType = 'pdf';
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.name.toLowerCase().endsWith('.docx')) {
        fileType = 'docx';
      } else {
        fileType = 'image'; // default fallback
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

  // --------------------------------------------------------------------------
  // EFFECT - Process Attachments to Base64
  // --------------------------------------------------------------------------

  /**
   * Processes attachments into base64 format for AI consumption
   * Separates files by type (images, PDFs, DOCX)
   */
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
            // Convert file to base64
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

            // Separate by file type
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

  // --------------------------------------------------------------------------
  // COMPUTED - Combined Attachments
  // --------------------------------------------------------------------------

  /**
   * Combines all processed attachments for AI hook
   * Falls back to initial attachments if none processed
   */
  const combinedAttachments = React.useMemo(() => {
    const combined = [...processedImages, ...processedPDFs, ...processedDOCX];
    return combined.length > 0 ? combined : initialAttachments;
  }, [processedImages, processedPDFs, processedDOCX, initialAttachments]);

  // --------------------------------------------------------------------------
  // COMPUTED - Upload State
  // --------------------------------------------------------------------------

  /**
   * Computes whether attachments are currently being uploaded
   * Based on the upload state from recoil atom
   */
  const isUploadingAttachments = React.useMemo(() => {
    return uploadState ? !uploadState.canUpload : false;
  }, [uploadState]);

  /**
   * Computes upload progress information
   */
  const uploadProgress = React.useMemo(() => {
    return {
      uploaded: uploadState?.uploaded ?? 0,
      total: uploadState?.attached ?? 0
    };
  }, [uploadState]);

  // --------------------------------------------------------------------------
  // COMPUTED - Effective Additional Context (labels for Task Writer)
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // AI TASK WRITER HOOK
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // COMPUTED - Current Display Response
  // --------------------------------------------------------------------------

  const restoredAiResponse = React.useMemo(
    () => restoreMedia(aiResponse, !isLoading),
    [aiResponse, isLoading, restoreMedia]
  );

  /**
   * Determines which response to display:
   * - During loading: shows streaming AI response
   * - With valid history index: shows historical response
   * - Otherwise: shows latest AI response
   */
  const currentDisplayResponse = React.useMemo(() => {
    // Always show live streaming response when loading
    if (isLoading) {
      return restoredAiResponse;
    }

    // Show historical response if valid index
    if (currentResponseIndex >= 0 && currentResponseIndex < responseHistory.length && responseHistory[currentResponseIndex]) {
      return responseHistory[currentResponseIndex].aiResponse;
    }

    // Default to latest response
    return restoredAiResponse;
  }, [currentResponseIndex, responseHistory, restoredAiResponse, isLoading]);

  /**
   * Gets the current response item from history
   * Returns null if no valid item selected
   */
  const getCurrentResponseItem = React.useMemo(() => {
    if (currentResponseIndex >= 0 && currentResponseIndex < responseHistory.length) {
      return responseHistory[currentResponseIndex];
    }
    return null;
  }, [currentResponseIndex, responseHistory]);

  // --------------------------------------------------------------------------
  // CORE ACTION - Send AI Request
  // --------------------------------------------------------------------------

  /**
   * Sends a request to the AI with contextual conversation history
   * 
   * Features:
   * - Builds context from recent conversation history
   * - Handles attachments with base64 conversion
   * - Provides error recovery by storing original input
   * - Updates UI optimistically
   * 
   * @param prompt - The user's input prompt
   * @param loadingTextParam - Optional loading text to display
   */
  const sendAIRequest = useCallback(async (
    prompt: string,
    loadingTextParam = "Thinking...",
    requestKindOverride?: "manual" | "auto-description",
  ) => {
    // Capture current state for history and error recovery
    const requestAttachments = currentAttachments;
    
    // Convert blob URLs to base64 for persistent storage
    const attachmentsForPersistentStorage = await Promise.all(
      requestAttachments.map(async (attachment) => {
        let persistentPreview = attachment.preview;

        // Convert blob URLs to base64
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

    // Block before clearing the prompt so the text stays if BYOK is not configured
    if (isByokBlocked) return;

    // Update UI state
    setLoadingText(loadingTextParam);
    setUserPrompt(""); // Clear input optimistically
    setCurrentPromptForHistory(prompt);
    setAttachmentsForHistory(attachmentsForPersistentStorage);

    // Store for error recovery
    setOriginalPromptForRestore(originalPrompt);
    setOriginalAttachmentsForRestore(requestAttachments);

    // Point to streaming response
    setCurrentResponseIndex(responseHistory.length);

    // Build contextual prompt with history
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

    await originalSendAIRequest(
      finalPrompt,
      loadingTextParam,
      requestKindOverride,
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

  // --------------------------------------------------------------------------
  // EFFECT - Error Recovery
  // --------------------------------------------------------------------------

  /**
   * Detects error responses and restores user input
   * Allows user to retry after an error without losing their work
   */
  useEffect(() => {
    if (!isLoading && originalPromptForRestore && hasError) {
      // Restore user's input
      setUserPrompt(originalPromptForRestore);
      setCurrentAttachments(originalAttachmentsForRestore);

      // Clear restore data. Keep history metadata so a retry can commit normally.
      setOriginalPromptForRestore("");
      setOriginalAttachmentsForRestore([]);
    }
  }, [aiResponse, isLoading, hasError, originalPromptForRestore, originalAttachmentsForRestore]);

  // --------------------------------------------------------------------------
  // EFFECT - Add Response to History
  // --------------------------------------------------------------------------

  /**
   * Adds completed AI responses to conversation history
   * Only triggers on successful, non-loading responses
   */
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
        
        // Update index to point to newly added item
        setCurrentResponseIndex(newHistory.length - 1);
        return newHistory;
      });
      
      // Clear temporary state
      setCurrentPromptForHistory("");
      setAttachmentsForHistory([]);
      setOriginalPromptForRestore("");
      setOriginalAttachmentsForRestore([]);
      clearAttachments();
    }
  }, [aiResponse, restoredAiResponse, isLoading, currentPromptForHistory, aiMode, attachmentsForHistory, clearAttachments, hasError, responseHistory.length]);

  // --------------------------------------------------------------------------
  // NAVIGATION METHODS
  // --------------------------------------------------------------------------

  /**
   * Navigates to a specific response in history
   * Ensures index stays within valid bounds
   * 
   * @param index - Target history index
   */
  const navigateResponse = useCallback((index: number) => {
    if (responseHistory.length === 0) {
      setCurrentResponseIndex(-1);
      return;
    }

    // Clamp index to valid range
    if (index < 0) {
      setCurrentResponseIndex(0);
    } else if (index >= responseHistory.length) {
      setCurrentResponseIndex(responseHistory.length - 1);
    } else {
      setCurrentResponseIndex(index);
    }
  }, [responseHistory.length]);

  /**
   * Clears all conversation history and resets state
   */
  const clearHistory = useCallback(() => {
    setResponseHistory([]);
    setCurrentResponseIndex(-1);
    setUserPrompt("");
    clearAttachments();
  }, [clearAttachments]);

  // --------------------------------------------------------------------------
  // DROPDOWN CALLBACKS
  // --------------------------------------------------------------------------

  /**
   * Handles AI model selection from dropdown
   * Updates current option and reorders display list
   */
  const dropDownButtonAICallback = useCallback((selected: TAiModal) => {
    const item = aiOptions.find(option => selected.id === option.id);
    if (item) {
      setAiOption(item);
      setDisplayAiOptions([item, ...aiOptions.filter(option => option.id !== item.id)]);
    }
  }, [setAiOption]);

  // --------------------------------------------------------------------------
  // CONTEXT VALUE
  // --------------------------------------------------------------------------

  const contextValue: AITaskWriterContextType = {
    // Core state
    aiMode,
    userPrompt,
    setUserPrompt,

    // AI Options state
    displayAiOptions,
    currentAiOption,

    // File Upload
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

    // Attachments (legacy support)
    attachments: currentAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    updateAttachmentWithS3Url,

    // Upload state tracking
    isUploadingAttachments,
    uploadProgress,

    // Response history
    responseHistory,
    currentResponseIndex,
    currentDisplayResponse,
    getCurrentResponseItem: () => getCurrentResponseItem,
    setCurrentResponseIndex,

    // Loading states
    isLoading,
    loadingText,
    setLoadingText,
    hasError,

    // Core actions
    sendAIRequest,
    retryLastRequest,
    navigateResponse,
    clearHistory,

    // Dropdown callbacks
    dropDownButtonAICallback,

    // BYOK gate
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

// ============================================================================
// CUSTOM HOOK
// ============================================================================

/**
 * Custom hook to access AITaskWriter context
 * Must be used within an AITaskWriterProvider
 * 
 * @throws Error if used outside provider
 * @returns AITaskWriterContextType
 */
export const useAITaskWriterContext = () => {
  const context = useContext(AITaskWriterContext);
  if (context === undefined) {
    throw new Error('useAITaskWriterContext must be used within an AITaskWriterProvider');
  }
  return context;
};
