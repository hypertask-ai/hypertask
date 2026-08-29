

// use this as a template for creating contexts. the usage is as .
// <TemplateProvider> 
//      <your components>
// </TemplateProvider>

// inside your components, you can call const {...} = TemplateContext()
import { ISection } from '@/models/model';
import React, { createContext, useContext, useState, ReactNode } from 'react';

// Define the type for the modal state
interface ISectionsState {
    unfilteredSections:ISection[];
    filteredSections:ISection[];
    setUnfilteredSections:React.Dispatch<React.SetStateAction<ISection[]>>;
    initialSections:ISection[]
  
}

// Create a context
const KanbanSectionsContext = createContext<ISectionsState | undefined>(undefined);

// Create a provider component
interface KanbanSectionsProps {
  children: ReactNode;
  sections:ISection[];
  filteredSections:ISection[]
}

export const KanbanSectionsProvider: React.FC<KanbanSectionsProps> = ({ children,sections,filteredSections }) => {
  const [unfilteredSections, setUnfilteredSections] = useState<ISection[]>(sections);
  console.log("🚀 ~ unfilteredSections:", unfilteredSections)
  
  // Combine state and setState into an object
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

// Create a custom hook to consume the context
export const useKanbanSectionsContext = (): ISectionsState => {
  const context = useContext(KanbanSectionsContext);

  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }

  return context;
};
