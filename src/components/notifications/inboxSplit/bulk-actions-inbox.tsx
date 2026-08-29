import { Dispatch, FC, SetStateAction } from "react";


interface IProps {
    selectedIds: number[];
    handleBulkReminder: (selectedItems: number[]) => Promise<void> | void;
    handleBulkArchive: (selectedItems: number[]) => Promise<void> | void;
    clearSelection: () => void;
}
const BulkActionsInbox: FC<IProps> = ({ selectedIds, clearSelection, handleBulkArchive, handleBulkReminder }) => {
    return (
        selectedIds?.length > 0 ? (
            <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
                <div className="bg-white text-black shadow-lg border-2 rounded-lg">
                    <div className="p-4">
                        <div className="flex items-center gap-4">
                            <span className="text-content font-medium">
                                {selectedIds.length} message{selectedIds.length !== 1 ? "s" : ""} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleBulkReminder(selectedIds)}
                                    className="flex items-center gap-2 px-3 py-1 border rounded bg-transparent hover:bg-gray-100 text-content"
                                    title="Add reminder (H)"
                                >
                                    {/* Replace with your Clock icon */}
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="10" strokeWidth="2" />
                                        <path strokeWidth="2" d="M12 6v6l4 2" />
                                    </svg>
                                    Remind
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleBulkArchive(selectedIds)}
                                    className="flex items-center gap-2 px-3 py-1 border rounded bg-transparent hover:bg-gray-100 text-content"
                                    title="Archive messages (E)"
                                >
                                    {/* Replace with your Archive icon */}
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <rect x="3" y="8" width="18" height="13" rx="2" strokeWidth="2" />
                                        <path strokeWidth="2" d="M16 3v5M8 3v5" />
                                    </svg>
                                    Archive
                                </button>
                                <button
                                    type="button"
                                    onClick={() => clearSelection()}
                                    className="px-3 py-1 rounded text-content text-gray-500 hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
        : <></>
)
}

export default BulkActionsInbox
