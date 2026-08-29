import React, { createContext, useContext, useState, ReactNode } from "react";
import { MobileViewContext } from "../../mobileContext";

// Define the type for the modal state
interface ModalState {
  showTagsModal: boolean;
  setShowTagsModal: React.Dispatch<React.SetStateAction<boolean>>;
  toggleShowTagsModal: () => void;
  toggleMoveModal: () => void;
  showMoveModal: boolean;
  setShowMoveModal: React.Dispatch<React.SetStateAction<boolean>>;
  togglePriorityModal: () => void;
  showPriorityModal: boolean;
  setShowSizeModal: React.Dispatch<React.SetStateAction<boolean>>;
  toggleShowSizeModal: () => void;
  showSizeModal: boolean;
  toggleDueDateModal: () => void;
  showDueDateModal: boolean;
  setDueDateModal: React.Dispatch<React.SetStateAction<boolean>>;
  showProjectsModal: boolean;
  toggleProjectsModal: () => void;
}

// Create a context
const ModalContext = createContext<ModalState | undefined>(undefined);

// Create a provider component
interface ModalProviderProps {
  children: ReactNode;
}

export const CreateTaskInfoColumnProvider: React.FC<ModalProviderProps> = ({
  children,
}) => {
  const [showMoveModal, setShowMoveModal] = useState<boolean>(false);
  const [showPriorityModal, setShowPriorityModal] = useState<boolean>(false);
  const [showSizeModal, setShowSizeModal] = useState<boolean>(false);
  const [showDueDateModal, setDueDateModal] = useState<boolean>(false);
  const [showTagsModal, setShowTagsModal] = useState<boolean>(false);
  const [showProjectsModal, setShowProjectsModal] = useState<boolean>(false);

  const _mbl = useContext(MobileViewContext);

  const toggleDueDateModal = () => setDueDateModal((prev) => !prev);
  const toggleMoveModal = () => setShowMoveModal((prev) => !prev);
  const togglePriorityModal = () => setShowPriorityModal((prev) => !prev);
  const toggleShowSizeModal = () => setShowSizeModal((prev) => !prev);
  const toggleShowTagsModal = () => setShowTagsModal((prev) => !prev);
  const toggleProjectsModal = () => setShowProjectsModal((prev) => !prev);

  const statesToReturn = {
    showTagsModal,
    setShowTagsModal,
    toggleShowTagsModal,
    toggleDueDateModal,
    showDueDateModal,
    setDueDateModal,
    toggleMoveModal,
    showMoveModal,
    setShowMoveModal,
    togglePriorityModal,
    showPriorityModal,
    toggleShowSizeModal,
    showSizeModal,
    setShowSizeModal,
    showProjectsModal,
    toggleProjectsModal,
  };
  
  return (
    <ModalContext.Provider value={statesToReturn}>
      {children}
    </ModalContext.Provider>
  );
};

// Create a custom hook to consume the context
export const useContextCreateTaskInfoColumn = (): ModalState => {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }

  return context;
};
