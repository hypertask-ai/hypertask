import Tooltip from "@/components/Common/Tooltip";
import dynamic from "next/dynamic";
const RemindMeComponent = dynamic(() => import("@/components/Modals/RemindMe/RemindMeComponent"));
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
    const toggleRemindMeModal = async (refresh?: boolean) => {

        setShowRemindMeModal(prev => !prev)
        if (refresh) {
            await router.refresh()
        }
    };
    const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";



    const handleKeyDown = (e: any) => {
        if (
            !show || e.defaultPrevented || showRemindMeModal || returnIfModalOrInputActive()) return;

        if (e.keyCode === 71) {
            const now = new Date().getTime();
            lastgClick.current = now;
            setTimeout(() => {
                lastgClick.current = null;
            }, globalConstants.gThenKeyDelay);
        }

        if (e.keyCode === 72) {
            e.preventDefault()
            if (lastgClick.current === null) toggleRemindMeModal()
        }

    }


    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [handleKeyDown])




    return (
        <>

            <button
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
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
                <Clock className="hover:!text-[#95999e]" style={{ color, height, width }} strokeWidth={1.75} />
                {children}
            </button>
            {showRemindMeModal &&
                <div onClick={(e) => e.stopPropagation()}>
                    <RemindMeComponent
                        closeHandler={toggleRemindMeModal}
                        isBulkMode={mode === "Bulk"}
                        bulkItems={selectedNotifications.map(x => ({ taskId: x.taskId, projectId: x.projectId }))}
                    />
                </div>}

        </>
    )
}

export default RemindMeInbox
