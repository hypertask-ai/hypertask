import Tooltip from "@/components/Common/Tooltip";
import RemindMeComponent from "@/components/Modals/RemindMe/RemindMeComponent";
import globalConstants from "@/lib/constants";
import { useBulkSelectionContext } from "@/lib/contexts/Inbox/BulkSelectionContext";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef, ReactNode } from "react";
import { Clock } from "lucide-react";

interface ArchiveTaskNotificationProps {
    children?: ReactNode;
    show: boolean;
    height?: number;
    width?: number;
    color?: string;
    mode?: "Bulk" | "Single";
    shouldShowToolTip?:boolean
}


const RemindMeInbox: React.FC<ArchiveTaskNotificationProps> = ({ children, show, height = 13, width = 13, color = "#696b6e", mode = "Single", shouldShowToolTip=true }) => {
    const { selectedNotifications } = useBulkSelectionContext()
    const router = useRouter()
    const [showRemindMeModal, setShowRemindMeModal] = useState(false);
    const lastgClick = useRef<number | null>(null);
    // ============ toggle remind me modal
    const toggleRemindMeModal = async (refresh?: boolean) => {

        setShowRemindMeModal(prev => !prev)
        if (refresh) {
            // await queryClient.refetchQueries({queryKey:["inbox"]})
            await router.refresh()
        }
    };
    const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";


    // eslint-disable-next-line react-hooks/exhaustive-deps
    const handleKeyDown = (e: any) => {
        if (
            showRemindMeModal || returnIfModalOrInputActive()) return;

        // =========== press [g]
        if (e.keyCode === 71) {
            const now = new Date().getTime();
            lastgClick.current = now;
            setTimeout(() => {
                lastgClick.current = null;
            }, globalConstants.gThenKeyDelay); // 1000 milliseconds = 1 second
        }

        // [h]
        if (e.keyCode === 72) {
            e.preventDefault()
            if (lastgClick.current === null) toggleRemindMeModal()
        }

    }


    useEffect(() => {
        // Add event listeners when the component mounts
        document.addEventListener('keydown', handleKeyDown);

        // Remove event listeners when the component unmounts
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown])




    return (
        <>

            <button
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation(); // Prevent the click event from propagating to the parent div
                    toggleRemindMeModal()
                }
                }
                className={` ${show ? "sm:block relative group flex items-center gap-1" : "hidden"}`}
            >
                {
                    shouldShowToolTip && 
                        <Tooltip
                            left={-70}
                            bottom={-40}
                            text="Remind"
                            keyCombination={["H"]}
                        />
                }
                {/* Tailwind can't compile template-literal classes (text-[${color}]) — inline style is the working path */}
                <Clock className="hover:!text-[#95999e]" style={{ color, height, width }} strokeWidth={1.75} />
                {children}
            </button>
            {showRemindMeModal &&
                <RemindMeComponent
                    closeHandler={toggleRemindMeModal}
                    isBulkMode={mode === "Bulk"}
                    bulkItems={selectedNotifications.map(x => ({ taskId: x.taskId, projectId: x.projectId }))}
                />}

        </>
    )
}

export default RemindMeInbox
