


import { ISection } from '@/models/model';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ISectionsState {
    unfilteredSections:ISection[];
    filteredSections:ISection[];
    setUnfilteredSections:React.Dispatch<React.SetStateAction<ISection[]>>;
    initialSections:ISection[]
  
}

const KanbanSectionsContext = createContext<ISectionsState | undefined>(undefined);

interface KanbanSectionsProps {
  children: ReactNode;
  sections:ISection[];
  filteredSections:ISection[]
}

export const KanbanSectionsProvider: React.FC<KanbanSectionsProps> = ({ children,sections,filteredSections }) => {
  const [unfilteredSections, setUnfilteredSections] = useState<ISection[]>(sections);
  console.log("🚀 ~ unfilteredSections:", unfilteredSections)
  
  const modalState: ISectionsState = {
    unfilteredSections,
    filteredSections,
    setUnfilteredSections,
    initialSections:sections
  };


  

  return (
    <KanbanSectionsContext.Provider value={modalState}>
      {children}
    </KanbanSectionsContext.Provider>
  );
};

export const useKanbanSectionsContext = (): ISectionsState => {
  const context = useContext(KanbanSectionsContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
