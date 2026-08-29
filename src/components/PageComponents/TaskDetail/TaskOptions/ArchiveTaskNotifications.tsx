import Tooltip from "@/components/Common/Tooltip";
import { Archive } from "lucide-react";

interface ArchiveTaskNotificationProps {
    selected:boolean;
    navigateToNextTask: (archiveNotification?: boolean, navigate?: boolean) => string | undefined
  }


const ArchiveTaskNotification:React.FC<ArchiveTaskNotificationProps> = (
  {...props}
)=>{
    return (
        <>
            <div>

                <button
                    className={` hidden relative group ${props.selected?"sm:block":"sm:block"}`}
                    onClick={()=>props.navigateToNextTask(true,true)} 

                >
                    <Tooltip
                        left={-180}
                        bottom={-45}
                        text="Remove notification"
                        keyCombination={["E"]}
                    />
                    <Archive
                      size={20}
                      strokeWidth={1.75}
                      fill="none"
                      className="keep-stroke task-option-icon text-[#696b6e] hover:text-[#95999e] transition-colors duration-75"
                    />
                    {/* <FiCheck size={15} color={notification.type==="Assigned"? (notification.assignee?.task?.status === 'Archive' ? 'green' : '#8E9093'): (notification.comment?.task?.status === 'Archive' ? 'green' : '#8E9093')} /> */}
                </button>
            </div>
        </>
    )
}

export default ArchiveTaskNotification
