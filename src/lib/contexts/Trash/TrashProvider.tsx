import HandleKeyboardFunctions from './handleKeyboardFunctions';
import { ITask, IProject } from '@/models/model';
import React, { createContext, ReactNode, useContext } from 'react';

interface TrashContextProps {
  selectedIndex: number;
  taskRef: React.RefObject<any>; // Replace 'any' with the actual type of your taskRef
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleMouseMove: () => void;
  deleteHandler: (mode: "recover" | "delete") => void;
  showConfirmation:boolean;
  toggleConfirmation:()=>void;
}

export const TrashContext = createContext<TrashContextProps | undefined>(undefined);

interface TrashContextProviderProps {
  children: ReactNode;
  tasks: ITask[]; // Replace with your actual type
  project: IProject; // Replace with your actual type
}

export const TrashContextProvider: React.FC<TrashContextProviderProps> = ({ children, tasks, project }) => {
  const contextValues = HandleKeyboardFunctions(tasks ?? [], project);

  return <TrashContext.Provider value={contextValues}>{children}</TrashContext.Provider>;
};

export const useTrashContext = () => {
  const context = useContext(TrashContext);
  if (!context) {
    throw new Error('useTrashContext must be used within a TrashContextProvider');
  }
  return context;
};
