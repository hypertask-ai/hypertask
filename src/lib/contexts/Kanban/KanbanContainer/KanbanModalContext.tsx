import useKanbanModalStates, {
  ITaskDeleteInfo,
} from "@/hooks/Homepage/useKanbanModalStates";
import React, { createContext, useContext, ReactNode } from "react";

interface ModalState {
  showManageViewsModal: boolean;
  showSaveModal: boolean;
  toggleManageViewsModal: () => void;
  toggleViewsModal: (switchToManage?: boolean) => void;
  showViewsModal: boolean;
  setShowViewsModal: React.Dispatch<React.SetStateAction<boolean>>;
  showManageColumnsModal: boolean;
  setShowManageColumnsModal: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSaveViewsModal: () => void;
  showDeleteTaskModal: boolean;
  toggleDeleteModal: (state: boolean, task?: ITaskDeleteInfo) => Promise<void>;
  taskInfo: ITaskDeleteInfo | undefined;
  setTaskInfo: React.Dispatch<
    React.SetStateAction<ITaskDeleteInfo | undefined>
  >;
  tasksToDelete: number[] | undefined;
  setTasksToDelete: React.Dispatch<React.SetStateAction<number[] | undefined>>;
  showSearchTasks: boolean,
  toggleSearchTasks: (val: boolean) => void,
}

const KanbanModalsContext = createContext<ModalState | undefined>(undefined);

interface ModalProviderProps {
  children: ReactNode;
}

export const KanbanModalsProvider: React.FC<ModalProviderProps> = ({
  children,
}) => {
  const modalState: ModalState = useKanbanModalStates();
  return (
    <KanbanModalsContext.Provider value={modalState}>
      {children}
    </KanbanModalsContext.Provider>
  );
};

export const useKanbanModalStatesContext = (): ModalState => {
  const context = useContext(KanbanModalsContext);

  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }

  return context;
};
