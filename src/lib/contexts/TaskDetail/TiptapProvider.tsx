/* eslint-disable react-hooks/exhaustive-deps */
import { IStatus, IUser, RedirectMode } from "@/models/model";
import type { Editor } from "@tiptap/react";
import { useContext, createContext, ReactNode, useState } from "react";

// ======================= Type Definitions =======================
interface TiptapProviderProps {
  children?: ReactNode;
  id: string;
  mode: RedirectMode;
  editor: Editor | null;
  stack: boolean | undefined;
  isSelected: boolean;
  handleFocus: (e?: any) => false | undefined;
  handleKeydown: (e: any) => void;
  handleCommentEscape: () => void;
  user: IUser | undefined;
  handleCallback: (
    mode_?: "moveToNext",
    inbox?: boolean,
    markAsDone?: boolean
  ) => Promise<boolean | undefined>;
  // Default send action: archives the inbox notification and, per the user's
  // inbox setting, advances to the next task.
  sendComment: () => Promise<boolean | undefined>;
  createdAt: string | undefined;
  getAttachments: (files: File[]) => Promise<void>;
  toggleHighlightHandler: (state: boolean) => void;
  newCommentAttachments: any[];
  trigger: boolean;
  isEditable: boolean;
  isEditModeActive: boolean;
  creator?: {
    createdAt: string | undefined;
    creator: string | undefined;
  };
  inbox?: boolean;
  inboxFlow?: string | null | undefined;
  status?: IStatus;
  handleTaskOptions?: (val: boolean) => void;
  handleFileDrop: (droppedFiles: FileList) => Promise<void>;
  droppedFiles: File[];
  resetDropFiles: () => void;
  discardDraft: (discard: "Description" | "Comment") => void;
  showDeleteComment: boolean;
  toggleAiTaskWriter: () => void;
  /** Desktop WriteWithAI inline float (Superhuman-style). */
  shouldShowInlineDraftAi?: boolean;
  closeInlineDraftAi?: () => void;
  aiProjectId?: number | null;
  aiTaskId?: number | null;
  audioTiptapCallback: (text: string, setContent?: boolean) => void;
  toggleRecording: (val: boolean) => void;
  isRecording: boolean;
}

interface ContextProps extends TiptapProviderProps {
  toggleExpansion: (event: any) => void;
  isExpanded: boolean;
}

// ======================= Context Creation =======================
const TiptapContext = createContext<ContextProps | undefined>(undefined);

// ======================= Provider Component =======================
const TiptapProvider: React.FC<TiptapProviderProps> = ({
  children,
  ...props
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [bgColor, setBgColor] = useState("");

  const toggleExpansion = (e: any) => {
    setIsExpanded(!isExpanded);
    setBgColor(bgColor === "black" ? "transparent" : "");
    // props.editor?.commands.focus
  };

  const contextValue: ContextProps = {
    toggleExpansion,
    isExpanded,
    ...props,
  };

  return (
    <TiptapContext.Provider value={contextValue}>
      {children}
    </TiptapContext.Provider>
  );
};

// ======================= Context Hook =======================
export const useTiptapGlobalContext = () => {
  const context = useContext(TiptapContext);
  if (!context) {
    throw new Error(
      "useTiptapGlobalContext must be used within a TiptapProvider"
    );
  }
  return context;
};

export default TiptapProvider;
