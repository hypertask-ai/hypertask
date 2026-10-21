import { Dispatch, ReactNode, SetStateAction } from "react";

export interface TCustomPromptContextType extends TReturnUseFileUploadingStates {
  onModalClose: () => void;
  handleChange: (e: any) => void;
  value: string;
  setLoading:Dispatch<SetStateAction<boolean>>;
  loading:boolean
}

export interface TCustomAIProviderProps {
  children: ReactNode;
  projectId: number;
  closeHandler: () => void;

}

export interface TReturnUseFileUploadingStates {
  uploadingFiles: any[];
  setUploadingFiles: (payload: SetStateAction<any[]>) => any[];
  uploadInProgress: boolean;
}
