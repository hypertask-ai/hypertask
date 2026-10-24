import Tooltip from "@/components/Common/Tooltip";
import { Archive } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7749_HEADER_ICON_SIZE_FLAG } from "@/lib/flags/definitions/htpr-7749-header-icon-size";

interface ArchiveTaskNotificationProps {
    selected:boolean;
    navigateToNextTask: (archiveNotification?: boolean, navigate?: boolean) => string | undefined
  }


const ArchiveTaskNotification:React.FC<ArchiveTaskNotificationProps> = (
  {...props}
)=>{
    const headerIconSizeEnabled = useFlag(HTPR_7749_HEADER_ICON_SIZE_FLAG);
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
                      size={headerIconSizeEnabled ? 16 : 20}
                      strokeWidth={1.75}
                      fill="none"
                      className={`${headerIconSizeEnabled ? "" : "keep-stroke "}task-option-icon text-[#696b6e] hover:text-[#95999e] transition-colors duration-75`}
                    />
                </button>
            </div>
        </>
    )
}

export default ArchiveTaskNotification
