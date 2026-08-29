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

/**
 * React Context to store and provide the state related to file uploads in a custom AI prompt modal.
 */
const CustomAIPromptContext = createContext<TCustomPromptContextType | undefined>(undefined);

/**
 * Provider component that manages file upload state for a custom AI prompt modal.
 * 
 * This component:
 * - Uses the `useFileUploadingStates` hook to track file uploads.
 * - Prevents modal closure if uploads are still in progress.
 * - Provides state and handler methods to descendant components through context.
 *
 * @param {TCustomAIProviderProps} props - The provider props, including `children`, `projectId`, and `closeHandler`.
 * @returns {JSX.Element} The context provider wrapping children.
 */
export const CustomAiProvider: FC<TCustomAIProviderProps> = ({ children, projectId, closeHandler }) => {
  const { uploadInProgress, uploadingFiles, setUploadingFiles } = useFileUploadingStates(
    REACT_QUERY_KEYS.CustomPrompt(projectId),
    REACT_QUERY_KEYS.uploadStates
  );
    const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
    const { loading, setLoading } = useLoadingState()

  /**
   * Handles modal close action.
   * Prevents closing if file uploads are still in progress and shows a toast message instead.
   */
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

/**
 * Custom hook to access the Custom AI Prompt context.
 * 
 * @returns {TCustomPromptContextType} The context value including upload state and modal close handler.
 * @throws {Error} If used outside of a `CustomAiProvider`.
 */
export const useCustomAiInstructions = (): TCustomPromptContextType => {
  const context = useContext(CustomAIPromptContext);
  if (context === undefined) {
    throw new Error("useCustomAiInstructions must be used within a CustomAiProvider");
  }
  return context;
};
