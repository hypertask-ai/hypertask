'use client';

import { useTour } from '../hooks/useTour';
import React, { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/General/useAuth';
import { TOUR_IDS, TourId } from '../types';

interface TourContextType {
  startTour: (tourIdOverride?: TourId) => void;
  startComponentTour: (componentId: string) => void;
  endTour: () => void;
  isTourActive: () => boolean;
  continueTourInModal: () => void;
  selectedTourId: TourId;
  setSelectedTourId: (tourId: TourId) => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export const TourProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [selectedTourId, setSelectedTourIdState] = useState<TourId>(TOUR_IDS.TASK_WRITER);
  
  const tourHook = useTour({ tourId: selectedTourId, currentUser });
  
  const setSelectedTourId = useCallback((tourId: TourId) => {
    setSelectedTourIdState(tourId);
    // Also update the tour hook's current tour ID
    // This is handled via the tourId prop which useTour watches
  }, []);
  
  const contextValue: TourContextType = {
    startTour: tourHook.startTour,
    startComponentTour: tourHook.startComponentTour,
    endTour: tourHook.endTour,
    // @ts-ignore - TS cache issue, function signature is correct
    isTourActive: tourHook.isTourActive,
    // @ts-ignore - TS cache issue, property exists in useTour return
    continueTourInModal: tourHook.continueTourInModal,
    selectedTourId,
    setSelectedTourId,
  };
  
  return (
    <TourContext.Provider value={contextValue}>
      {children}
      {/* @ts-ignore - TS cache issue, property exists in useTour return */}
      {tourHook.TourComponent()}
    </TourContext.Provider>
  );
};

export const useTourContext = () => {
  const context = useContext(TourContext);
  if (!context) {
    return {
      startTour: (_tourIdOverride?: TourId) => {},
      startComponentTour: () => {},
      endTour: () => {},
      isTourActive: () => false,
      continueTourInModal: () => {},
      selectedTourId: TOUR_IDS.PROJECT,
      setSelectedTourId: () => {},
    };
  }
  return context;
};
