'use client'
import useFileUploadingStates from "@/hooks/General/useFileUploadingStates";
import useInput from "@/hooks/General/useInput";
import useLoadingState from "@/hooks/General/useLoadingState";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";
import { TCustomAIProviderProps, TCustomPromptContextType } from "@/models/Contexts";
import { currentProjectAtom } from "@/store";
import { createContext, FC, ReactNode, useContext } from "react";
import toast from "react-hot-toast";
import { useRecoilState } from "@/lib/state";

const CustomAIPromptContext = createContext<TCustomPromptContextType | undefined>(undefined);

export const CustomAiProvider: FC<TCustomAIProviderProps> = ({ children, projectId, closeHandler }) => {
  const { uploadInProgress, uploadingFiles, setUploadingFiles } = useFileUploadingStates(
    REACT_QUERY_KEYS.CustomPrompt(projectId),
    REACT_QUERY_KEYS.uploadStates
  );
    const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
    const { loading, setLoading } = useLoadingState()

  const onModalClose = () => {
    if (uploadInProgress) return toast("Please wait while the uploads have finished!");
    closeHandler();
  };

  const { handleChange, input: value } = useInput({
    defaultValue: _currentProject?.ai_custom_instructions?.[0]?.customInstruction ?? ""
})
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
