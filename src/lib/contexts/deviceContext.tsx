
import React, { createContext, useContext, ReactNode } from 'react';


const DeviceContext = createContext<boolean | undefined>(undefined);

interface DeviceProviderProps {
  children: ReactNode;
  initialIsApple: boolean;
}

export const DeviceProvider: React.FC<DeviceProviderProps> = ({
  children,
  initialIsApple,
}) => {
  return (
    <DeviceContext.Provider value={initialIsApple}>
      {children}
    </DeviceContext.Provider>
  );
};

export const useDeviceContext = (): boolean => {
  const context = useContext(DeviceContext);

  return context ?? true;
};
