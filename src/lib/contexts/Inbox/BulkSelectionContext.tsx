

// use this as a template for creating contexts. the usage is as .
// <TemplateProvider> 
//      <your components>
// </TemplateProvider>

// inside your components, you can call const {...} = TemplateContext()
import { INotification, TRemoveFromInboxMode } from '@/models/model';
import { createContext, useContext, useState, ReactNode, Dispatch, SetStateAction, useMemo, useEffect } from 'react';

interface IShareableProps {
    handleBulkArchive: (selectedNotifications: INotification[]) => Promise<void>
}
// Define the type for the modal state
interface BulkSelectionState extends IShareableProps {
    setSelectedIds: Dispatch<SetStateAction<Set<number>>>;
    selectedIds: Set<number>;
    selectAllFromAllTabs: () => void;
    selectedIdsArray: number[];
    allItems: INotification[];
    handleBulkArchive: () => Promise<void>;
    selectedNotifications: INotification[];
    isAllSelected: boolean
}

// Create a context
const BulkSelectionContext = createContext<BulkSelectionState | undefined>(undefined);

// Create a provider component
interface ModalProviderProps extends IShareableProps {
    children: ReactNode;
    allItems: INotification[]
    resetSelectionKey?: string;

}

export const BulkSelectionProvider: React.FC<ModalProviderProps> = (props) => {
    const { children, allItems, handleBulkArchive: bulkArchiveFromProps, resetSelectionKey } = props
    const [isAllSelected, setIsAllSelected] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    // Selected ids can reference rows the caller no longer passes in allItems
    // (e.g. hidden by the inbox reduced search); a stale set would archive
    // fewer items than the selection count shows. Only a narrowing key resets:
    // an empty key means no filter, where every selected row is visible again.
    useEffect(() => {
        if (!resetSelectionKey) return;
        setSelectedIds(new Set());
        setIsAllSelected(false);
    }, [resetSelectionKey])
    const selectedNotifications = useMemo(() => allItems?.filter(notification => selectedIds.has(parseInt(notification.id))), [allItems, selectedIds])
    const areAllSelected = selectedNotifications.length === allItems.length
    const selectAllFromAllTabs = () => {
        // first if all items are already selected, then deselect all. 
        if (areAllSelected) return clearSelection()

        const allIds = allItems.map(item => parseInt(item.id));
        setSelectedIds(new Set(allIds))
        setIsAllSelected(true);
    }


    const clearSelection = () => setSelectedIds(new Set())
    const handleBulkArchive = async () => {
        const selectedIdsArray = Array.from(selectedIds);
        const selectedNotifications = allItems?.filter(notification => selectedIdsArray.includes(parseInt(notification.id)))
        // Archive all selected notifications
        bulkArchiveFromProps(selectedNotifications)
        clearSelection()
    }


    useEffect(() => {
        if (selectedNotifications.length === 0) {
            setIsAllSelected(false);
        }
        else if (areAllSelected) {
            setIsAllSelected(true);
        }
    }, [areAllSelected, selectedNotifications])

    return (
        <BulkSelectionContext.Provider
            value={{
                selectedIds,
                setSelectedIds, selectAllFromAllTabs,
                selectedIdsArray: Array.from(selectedIds),
                allItems,
                handleBulkArchive,
                selectedNotifications,
                isAllSelected
            }}>
            {children}
        </BulkSelectionContext.Provider>
    );
};

// Create a custom hook to consume the context
export const useBulkSelectionContext = (): BulkSelectionState => {
    const context = useContext(BulkSelectionContext);

    if (!context) {
        throw new Error('useModal must be used within a ModalProvider');
    }

    return context;
};
