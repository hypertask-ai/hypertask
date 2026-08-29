import { IUploadingDescription } from "@/models/model";
import RelativeTime from "@/components/Common/RelativeTime";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import CreatedBy from "../../../CommentAndDescription/Common/CreatedBy";

interface IProps {
  name: string;
  pfp: string;
  isUploadingDescription?: IUploadingDescription;
}
const SharedDescriptionTopRow: React.FC<IProps> = ({
  name,
  pfp,
  isUploadingDescription,
}) => {
  return (
    <div className="flex justify-between">
      <span className="text-meta text-text-light-gray">
        {!isUploadingDescription ? (
          <CreatedBy name={name} pfp={pfp} isStacked={false} />
        ) : (
          "Updating..."
        )}
      </span>

      <DescriptionTopRight />
    </div>
  );
};

const DescriptionTopRight = () => {
  const { currentTask } = useTaskContext();

  return (
    <div className="flex gap-1 items-center">
      <span className="text-meta text-text-light-gray">
        <RelativeTime date={currentTask?.createdAt} />
      </span>
    </div>
  );
};

export default SharedDescriptionTopRow;
