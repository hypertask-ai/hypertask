'use client'
import useFileUploadingStates from "@/hooks/General/useFileUploadingStates";
import type { ChangeEvent } from "react";
import useLoadingState from "@/hooks/General/useLoadingState";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";
import { TCustomAIProviderProps, TCustomPromptContextType } from "@/models/Contexts";
import { createContext, FC, useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";

export const CustomAIPromptContext = createContext<TCustomPromptContextType | undefined>(undefined);

export const CustomAiProvider: FC<TCustomAIProviderProps> = ({ children, initialInstruction, projectId, closeHandler }) => {
  const { uploadInProgress, uploadingFiles, setUploadingFiles } = useFileUploadingStates(
    REACT_QUERY_KEYS.CustomPrompt(projectId),
    REACT_QUERY_KEYS.uploadStates
  );
    const { loading, setLoading } = useLoadingState()

  const onModalClose = () => {
    if (uploadInProgress) return toast("Please wait while the uploads have finished!");
    closeHandler();
  };

  const [draft, setDraft] = useState({ saved: initialInstruction, value: initialInstruction });
  useEffect(() => {
    setDraft((previous) => ({
      saved: initialInstruction,
      value: previous.value === previous.saved ? initialInstruction : previous.value,
    }));
  }, [initialInstruction]);
  const value = draft.value;
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => setDraft((previous) => ({
    ...previous,
    value: event.target.value,
  }));
  return (
    <CustomAIPromptContext.Provider
      value={{ 
        uploadInProgress, 
        uploadingFiles, 
        setUploadingFiles, 
        onModalClose, 
        handleChange, 
        value,
        setLoading,
        loading
      }}
    >
      {children}
    </CustomAIPromptContext.Provider>
  );
};

export const useCustomAiInstructions = (): TCustomPromptContextType => {
  const context = useContext(CustomAIPromptContext);
  if (context === undefined) {
    throw new Error("useCustomAiInstructions must be used within a CustomAiProvider");
  }
  return context;
};
