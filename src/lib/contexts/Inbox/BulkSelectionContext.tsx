


import { INotification, TRemoveFromInboxMode } from '@/models/model';
import { createContext, useContext, useState, ReactNode, Dispatch, SetStateAction, useMemo, useEffect } from 'react';

interface IShareableProps {
    handleBulkArchive: (selectedNotifications: INotification[]) => Promise<void>
}
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

const BulkSelectionContext = createContext<BulkSelectionState | undefined>(undefined);

interface ModalProviderProps extends IShareableProps {
    children: ReactNode;
    allItems: INotification[]
    resetSelectionKey?: string;

}

export const BulkSelectionProvider: React.FC<ModalProviderProps> = (props) => {
    const { children, allItems, handleBulkArchive: bulkArchiveFromProps, resetSelectionKey } = props
    const [isAllSelected, setIsAllSelected] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    useEffect(() => {
        if (!resetSelectionKey) return;
        setSelectedIds(new Set());
        setIsAllSelected(false);
    }, [resetSelectionKey])
    const selectedNotifications = useMemo(() => allItems?.filter(notification => selectedIds.has(parseInt(notification.id))), [allItems, selectedIds])
    const areAllSelected = selectedNotifications.length === allItems.length
    const selectAllFromAllTabs = () => {
        if (areAllSelected) return clearSelection()

        const allIds = allItems.map(item => parseInt(item.id));
        setSelectedIds(new Set(allIds))
        setIsAllSelected(true);
    }


    const clearSelection = () => setSelectedIds(new Set())
    const handleBulkArchive = async () => {
        const selectedIdsArray = Array.from(selectedIds);
        const selectedNotifications = allItems?.filter(notification => selectedIdsArray.includes(parseInt(notification.id)))
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

export const useBulkSelectionContext = (): BulkSelectionState => {
    const context = useContext(BulkSelectionContext);

    if (!context) {
        throw new Error('useModal must be used within a ModalProvider');
    }

    return context;
};
