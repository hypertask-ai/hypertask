import HandleKeyboardFunctions from './searchCompHandleKeydown';
import { ITask, IProject } from '@/models/model';
import React, { createContext, ReactNode, useContext } from 'react';

interface SearchContextProps {
  selectedIndex: number;
  listItemRef: React.RefObject<any>
  handleMouseEnter: (index: number) => void;
  handleMouseLeave: () => void;
  handleMouseMove: () => void;
  deleteHandler: (mode: "recover" | "delete") => void;
  showConfirmation:boolean;
  toggleConfirmation:()=>void;
  EnterHandler: (task: ITask) => Promise<void>;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
  filteredTasks: ITask[];
  _parsedProjects: IProject[];
}

export const SearchListContext = createContext<SearchContextProps | undefined>(undefined);

interface SearchContextProviderProps {
  children: ReactNode;
  _parsedProjects: any;
  filteredTasks: ITask[];
}

export const SearchContextProvider: React.FC<SearchContextProviderProps> = ({ children, filteredTasks, _parsedProjects }) => {
  const contextValues = {
    ...HandleKeyboardFunctions(filteredTasks ?? []),
    filteredTasks,
    _parsedProjects,
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
