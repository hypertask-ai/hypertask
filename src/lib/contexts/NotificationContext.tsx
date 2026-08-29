import React, { createContext, ReactNode, useContext } from 'react';

import { INotification } from '@/models/model';
import { DisplayAvatar } from '@prisma/client';

interface NotificationContextProps {
  notification: INotification;
  isIbxSlctd: boolean;
  selectedSplit:string 
  selectedIds?:number[]
  displayAvatar: DisplayAvatar
}

interface ProviderProps extends NotificationContextProps {
  children:ReactNode;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(undefined);

const NotificationProvider: React.FC<ProviderProps> = ({ children, selectedSplit, notification, isIbxSlctd = false, selectedIds, displayAvatar }) => {
  const contextValue = { notification, isIbxSlctd, selectedSplit, selectedIds, displayAvatar };

  return <NotificationContext.Provider value={contextValue}>{children}</NotificationContext.Provider>;
};

const useNotificationContext = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotificationContext must be used within a NotificationProvider');
  }
  return context;
};

export { NotificationProvider, useNotificationContext };
