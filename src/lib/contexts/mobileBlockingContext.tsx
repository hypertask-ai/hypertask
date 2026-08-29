"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

interface MobileBlockingContextType {
  shouldShowMobileOverlay: boolean;
  userEmail: string;
  showMobileOverlay: (email: string) => void;
  hideMobileOverlay: () => void;
}

const MobileBlockingContext = createContext<MobileBlockingContextType>({
  shouldShowMobileOverlay: false,
  userEmail: "",
  showMobileOverlay: () => {},
  hideMobileOverlay: () => {},
});

export const useMobileBlocking = () => {
  const context = useContext(MobileBlockingContext);
  if (!context) {
    throw new Error(
      "useMobileBlocking must be used within MobileBlockingProvider"
    );
  }
  return context;
};

interface MobileBlockingProviderProps {
  children: ReactNode;
}

export const MobileBlockingProvider: React.FC<MobileBlockingProviderProps> = ({
  children,
}) => {
  const [shouldShowMobileOverlay, setShouldShowMobileOverlay] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  const showMobileOverlay = (email: string) => {
    setUserEmail(email);
    setShouldShowMobileOverlay(true);
  };

  const hideMobileOverlay = () => {
    setShouldShowMobileOverlay(false);
    setUserEmail("");
  };

  return (
    <MobileBlockingContext.Provider
      value={{
        shouldShowMobileOverlay,
        userEmail,
        showMobileOverlay,
        hideMobileOverlay,
      }}
    >
      {children}
    </MobileBlockingContext.Provider>
  );
};


