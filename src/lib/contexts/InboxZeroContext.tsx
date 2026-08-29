"use client";

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface InboxZeroContextType {
  isInboxZero: boolean;
  setIsInboxZero: (isZero: boolean) => void;
}

const InboxZeroContext = createContext<InboxZeroContextType | undefined>(undefined);

export const useInboxZero = () => {
  const context = useContext(InboxZeroContext);
  if (context === undefined) {
    throw new Error('useInboxZero must be used within an InboxZeroProvider');
  }
  return context;
};

interface InboxZeroProviderProps {
  children: ReactNode;
}

export const InboxZeroProvider = ({ children }: InboxZeroProviderProps) => {
  const [isInboxZero, setIsInboxZero] = useState(false);

  return (
    <InboxZeroContext.Provider value={{ isInboxZero, setIsInboxZero }}>
      {children}
    </InboxZeroContext.Provider>
  );
};
