import HandleKeyboardFunctions from './searchCompHandleKeydown';
import { ITask, IProject } from '@/models/model';
import React, { createContext, ReactNode, useContext } from 'react';

interface SearchContextProps {
  selectedIndex: number;
  listItemRef: React.RefObject<any> // Replace 'any' with the actual type of your taskRef
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleMouseMove: () => void;
  deleteHandler: (mode: "recover" | "delete") => void;
  showConfirmation:boolean;
  toggleConfirmation:()=>void;
  EnterHandler: (task: ITask) => Promise<void>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
  filteredTasks: ITask[]; // Added filteredTasks
  _parsedProjects: IProject[]; // Added _parsedProjects
}

export const SearchListContext = createContext<SearchContextProps | undefined>(undefined);

interface SearchContextProviderProps {
  children: ReactNode;
  _parsedProjects: any;
  filteredTasks: ITask[]; // Replace with your actual type
}

export const SearchContextProvider: React.FC<SearchContextProviderProps> = ({ children, filteredTasks, _parsedProjects }) => {
  const contextValues = {
    ...HandleKeyboardFunctions(filteredTasks ?? []),
    filteredTasks, // Pass filteredTasks to the context
    _parsedProjects, // Pass _parsedProjects to the context
 };



  return <SearchListContext.Provider value={contextValues}>{children}</SearchListContext.Provider>;
};

export const useSearchListContext = () => {
  const context = useContext(SearchListContext);
  if (!context) {
    throw new Error('useSearchListContext must be used within a SearchContextProvider');
  }
  return context;
};
