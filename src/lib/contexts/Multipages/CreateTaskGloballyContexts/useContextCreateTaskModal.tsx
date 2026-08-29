

// use this as a template for creating contexts. the usage is as .
// <TemplateProvider> 
//      <your components>
// </TemplateProvider>

// inside your components, you can call const {...} = TemplateContext()
import useCreateTaskModalGlobalStates from '@/hooks/MultiPages/Tasks/useCreateTaskModalStates';
import { ITaskGlobalStates } from '@/models/CreateTaskModalModels/model';
import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the type for the modal state
interface ModalState {
  // currentProject:any
}

// Create a context
const CreateTaskModalContext = createContext<ITaskGlobalStates | undefined>(undefined);

// Create a provider component
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

// Create a custom hook to consume the context
export const useContextCreateTaskModal = (): ITaskGlobalStates => {
  const context = useContext(CreateTaskModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
