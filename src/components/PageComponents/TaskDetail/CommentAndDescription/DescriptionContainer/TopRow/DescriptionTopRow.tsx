import DescriptionTopRight from "./DescriptionTopRight"
import CreatedBy from "../../Common/CreatedBy"
import { IUploadingDescription } from '@/models/model';
import { taskDetailSpacing } from "@/lib/configs/taskDetail.config";
import { cn } from "@/utils/undoActions/helperFuncs";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import type { PersonHovercardSubject } from "@/models/personHovercard";

interface IProps {
  name: string;
  pfp: string;
  isUploadingDescription?: IUploadingDescription
  projectId?: number;
  subject?: PersonHovercardSubject | null;
}
const DescriptionTopRow: React.FC<IProps> = ({ name, pfp, isUploadingDescription, projectId, subject }) => {
  const isMbl = useContext(MobileViewContext);
  return (
    <div
      className={cn("flex justify-between", isMbl ? taskDetailSpacing.mobile.descriptionContainer : "")}>
      <span className='text-meta text-text-light-gray'>
        {
          !isUploadingDescription ?
            (
              <CreatedBy
                name={name}
                pfp={pfp}
                projectId={projectId}
                subject={subject}
                isStacked={false} />
            )
            :
            "Updating..."
        }
      </span>


      <DescriptionTopRight />
    </div>
  )

}


export default DescriptionTopRow
