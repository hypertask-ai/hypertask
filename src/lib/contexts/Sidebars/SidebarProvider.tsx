
import React, { createContext, ReactNode, useContext } from 'react';

interface SidebarContextProps {
    _appHandler?:()=>void

}

export const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

interface SidebarContextProviderProps extends SidebarContextProps{
  children: ReactNode;
}

export const SidebarContextProvider: React.FC<SidebarContextProviderProps> = ({ children, _appHandler }) => {
  
  return <SidebarContext.Provider value={{_appHandler}}>{children}</SidebarContext.Provider>;
};

export const useSidebarContext = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarContextProvider');
  }
  return context;
};
