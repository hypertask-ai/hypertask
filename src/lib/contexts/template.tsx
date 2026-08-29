

// use this as a template for creating contexts. the usage is as .
// <TemplateProvider> 
//      <your components>
// </TemplateProvider>

// inside your components, you can call const {...} = TemplateContext()
import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the type for the modal state
interface ModalState {
  
}

// Create a context
const ModalContext = createContext<ModalState | undefined>(undefined);

// Create a provider component
interface ModalProviderProps {
  children: ReactNode;
  
}

export const ModalProvider: React.FC<ModalProviderProps> = ({ children,}) => {
  
  return (
    <ModalContext.Provider value={undefined}>
      {children}
    </ModalContext.Provider>
  );
};

// Create a custom hook to consume the context
export const useTaskModals = (): ModalState => {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
