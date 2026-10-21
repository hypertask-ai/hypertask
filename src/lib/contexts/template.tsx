


import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ModalState {
  
}

const ModalContext = createContext<ModalState | undefined>(undefined);

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

export const useTaskModals = (): ModalState => {
  const context = useContext(ModalContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
