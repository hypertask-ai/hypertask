import { IUploadingDescription } from "@/models/model";
import formatDateDifference from "@/utils/generateTime";
import TutorialCreatedBy from "../Task/CreatedBy";
interface IProps {
  name: string;
  pfp: string;
  isUploadingDescription?: IUploadingDescription;
}
const DescriptionTopRow: React.FC<IProps> = ({
  name,
  pfp,
  isUploadingDescription,
}) => {
  return (
    <div className="flex justify-between">
      <span className="text-meta text-text-light-gray">
        {!isUploadingDescription ? (
          <TutorialCreatedBy name={name} pfp={pfp} size={18} />
        ) : (
          "Updating..."
        )}
      </span>

      <DescriptionTopRight />
    </div>
  );
};

const DescriptionTopRight = () => {
  return (
    <div className="flex gap-1 items-center">
      <span className="text-meta text-text-light-gray">
        {formatDateDifference("25 Sept")}
      </span>
    </div>
  );
};

export default DescriptionTopRow;
