import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";
import styles from "@/styles/tiptap.module.scss";
import { Circle } from "lucide-react";
import UserAvatar from "@/components/Common/UserAvatar";
import { ParentPersonHovercard } from "@/components/Common/PersonHovercard";
import type { PersonHovercardSubject } from "@/models/personHovercard";

interface ICreatedBy {
  name: string;
  pfp: string;
  isStacked: boolean;
  saved?: boolean;
  publicSave?: boolean;
  projectId?: number;
  subject?: PersonHovercardSubject | null;
}

const CreatedBy: React.FC<ICreatedBy> = ({
  name,
  pfp,
  isStacked,
  saved,
  publicSave,
  projectId,
  subject,
}) => {
  const mbl = useContext(MobileViewContext);
  // if both conditions have same font, thats intentional please do not change.
  return mbl ? (
    <div className={`flex items-center gap-2 ${styles.unstacked_grid_row1}`}>
      {(publicSave || saved) && (
        <StarAndPinDots starred={saved ?? false} pinned={publicSave ?? false} />
      )}
      <ParentPersonHovercard projectId={projectId} subject={subject} />
      <UserAvatar
        alt={`${name || "Comment author"} avatar`}
        name={name}
        photoURL={pfp}
        size={18}
      />
      <span
        className={`${
          isStacked ? "text-content" : "text-content"
        } text-[#8E9093]`}
      >
        {name}
      </span>
    </div>
  ) : (
    <div className={`flex items-start gap-2 ${styles.unstacked_grid_row1}`}>
      {(publicSave || saved) && (
        <StarAndPinDots starred={saved ?? false} pinned={publicSave ?? false} />
      )}
      <ParentPersonHovercard projectId={projectId} subject={subject} />
      <UserAvatar
        alt={`${name || "Comment author"} avatar`}
        name={name}
        photoURL={pfp}
        size={18}
      />
      <span
        className={`${
          isStacked ? "text-content" : "text-content"
        } text-[#8E9093]`}
      >
        {name}
      </span>
    </div>
  );
};

const StarAndPinDots = ({
  starred,
  pinned,
}: {
  starred: boolean;
  pinned: boolean;
}) => {
  return (
    <div className={`md:w-fit flex items-center justify-center pr-1`}>
      {starred === true && pinned !== true ? (
        <Circle size={7} className="fill-current text-[#FFCB33] w-new-notification relative z-10"  strokeWidth={1.75} fill="currentColor"/>
      ) : (
        <></>
      )}
      {pinned === true ? (
        <Circle size={7}
          className="fill-current text-[#fd831e] w-new-notification relative z-0"
         strokeWidth={1.75} fill="currentColor"/>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CreatedBy;
