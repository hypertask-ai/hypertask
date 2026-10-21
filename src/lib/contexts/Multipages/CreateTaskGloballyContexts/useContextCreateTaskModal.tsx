


import useCreateTaskModalGlobalStates from '@/hooks/MultiPages/Tasks/useCreateTaskModalStates';
import { ITaskGlobalStates } from '@/models/CreateTaskModalModels/model';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ModalState {
}

const CreateTaskModalContext = createContext<ITaskGlobalStates | undefined>(undefined);

interface ModalProviderProps {
  children: ReactNode;
  
}

export const CreateTaskModalProvider: React.FC<ModalProviderProps> = ({ children,}) => {
  const states = useCreateTaskModalGlobalStates()
  return (
    <CreateTaskModalContext.Provider value={states}>
      {children}
    </CreateTaskModalContext.Provider>
  );
};

export const useContextCreateTaskModal = (): ITaskGlobalStates => {
  const context = useContext(CreateTaskModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
