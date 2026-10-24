import Tooltip from "@/components/Common/Tooltip";
import globalConstants from "@/lib/constants";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7749_HEADER_ICON_SIZE_FLAG } from "@/lib/flags/definitions/htpr-7749-header-icon-size";

interface ArchiveTaskNotificationProps {
  children?:ReactNode;
  color:"#95999E"|"#696b6e";
  hoverText:"#95999E"
  navigateToNextTask: (archiveNotification?: boolean, shouldNavigate?: boolean, remindMe?: boolean, force?: "forceNavigate", inboxFlow?: string | null) => string | undefined
  remindTask?: boolean;
  isHeader?: boolean;
}


const RemindMeTaskDetail:React.FC<ArchiveTaskNotificationProps> = (
  {...props}
)=>{
    const headerIconSizeEnabled = useFlag(HTPR_7749_HEADER_ICON_SIZE_FLAG) && props.isHeader;
    const searchParams = useSearchParams()
    const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]
    const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";
    const lastgClick = useRef<number | null>(null);
    const { showRemindMeModal, setShowRemindMeModal, isRecording } = useTaskContext()

  const toggleRemindMeModal = async(refresh?:boolean) => {
  
    setShowRemindMeModal(prev=>!prev)
    if (refresh){
      const inboxFlow = searchParams?.get("inboxFlow")
      props.navigateToNextTask(true, true, true, "forceNavigate", inboxFlow)
    }
  };


  const handleKeyDown=(e:any) => {
    if ( showRemindMeModal || returnIfModalOrInputActive() || isRecording ) return;
  if (e.keyCode===71) {
    const now = new Date().getTime();
    lastgClick.current = now;
    setTimeout(() => {
      lastgClick.current = null;
    }, globalConstants.gThenKeyDelay);
  }
    if (e.keyCode===72 && !e.shiftKey){
        e.preventDefault()
        if (lastgClick.current ===null) toggleRemindMeModal()
    } 
  }


  useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);

        return () => {
        document.removeEventListener('keydown', handleKeyDown);
        };
  }, [showRemindMeModal, isRecording])
  



    return (
        <>

                <button
                    onClick={()=>toggleRemindMeModal()}
                    className="relative group flex gap-1 items-center"
                >
                    <Tooltip
                        left={-100}
                        bottom={-45}
                        text="Remind"
                        keyCombination={["H"]}
                    />
                    <Clock
                      size={headerIconSizeEnabled ? 20 : 18}
                      strokeWidth={1.75}
                      fill="none"
                      className={headerIconSizeEnabled ? "keep-stroke task-option-icon text-[#696b6e] hover:text-[#95999e]" : "task-option-icon h-[18px] w-[18px] text-[#696b6e] hover:text-[#95999e]"}
                    />
                    {props?.children}

                </button>

        </>
    )
}

export default RemindMeTaskDetail