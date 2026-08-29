import Tooltip from "@/components/Common/Tooltip";
import globalConstants from "@/lib/constants";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import { returnIfModalOrInputActive } from "@/utils/helperFunctions/helperFunctions";
import { useSearchParams } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

interface ArchiveTaskNotificationProps {
  children?:ReactNode;
  color:"#95999E"|"#696b6e";
  hoverText:"#95999E"
  navigateToNextTask: (archiveNotification?: boolean, shouldNavigate?: boolean, remindMe?: boolean, force?: "forceNavigate", inboxFlow?: string | null) => string | undefined
  remindTask?: boolean;
}


const RemindMeTaskDetail:React.FC<ArchiveTaskNotificationProps> = (
  {...props}
)=>{
    const searchParams = useSearchParams()
    const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]
    const tipTapClassName: string = "tiptap ProseMirror ProseMirror-focused";
    const lastgClick = useRef<number | null>(null);
    const { showRemindMeModal, setShowRemindMeModal, isRecording } = useTaskContext()

      // ============ toggle remind me modal
  const toggleRemindMeModal = async(refresh?:boolean) => {
  
    setShowRemindMeModal(prev=>!prev)
    if (refresh){
      // No router.refresh() here: navigateToNextTask queues router.replace to
      // the next task and a refresh's completing transition restores the old
      // URL, cancelling the advance (HTPR-4234/HTPR-4570). A snooze always
      // leaves the task page (HTPR-4595): next task, else back.
      const inboxFlow = searchParams?.get("inboxFlow")
      props.navigateToNextTask(true, true, true, "forceNavigate", inboxFlow)
    }
  };


  const handleKeyDown=(e:any) => {
    if ( showRemindMeModal || returnIfModalOrInputActive() || isRecording ) return;
  // [g]
  if (e.keyCode===71) {
    const now = new Date().getTime();
    lastgClick.current = now;
    setTimeout(() => {
      lastgClick.current = null;
    }, globalConstants.gThenKeyDelay); // 1000 milliseconds = 1 second
  }
  // [h]
    if (e.keyCode===72 && !e.shiftKey){
        e.preventDefault()
        if (lastgClick.current ===null) toggleRemindMeModal()
    } 
  }


  useEffect(() => {
  // Add event listeners when the component mounts
        document.addEventListener('keydown', handleKeyDown);

        // Remove event listeners when the component unmounts
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
                      size={18}
                      strokeWidth={1.75}
                      fill="none"
                      className="task-option-icon h-[18px] w-[18px] text-[#696b6e] hover:text-[#95999e]"
                    />
                    {props?.children}

                </button>

        </>
    )
}

export default RemindMeTaskDetail