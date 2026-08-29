
// inside your components, you can call const {...} = TemplateContext()
import React, { createContext, useContext, ReactNode } from 'react';

// Define the type for the modal state

// Create a context
const DeviceContext = createContext<boolean | undefined>(undefined);

// Create a provider component
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

// Create a custom hook to consume the context
export const useDeviceContext = (): boolean => {
  const context = useContext(DeviceContext);


  // if (!context) {
  //   throw new Error('useDeviceContext must be used within a DeviceProvider');
  // }

  return context ?? true;
};
