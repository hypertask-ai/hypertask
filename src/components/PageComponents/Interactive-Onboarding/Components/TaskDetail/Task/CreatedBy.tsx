import { getStyle } from "@/lib/constants/InteractiveOnboarding/constants";
import styles from "@/styles/tiptap.module.scss";

const TutorialCreatedBy = ({
  name,
  pfp,
  size,
}: {
  name: string;
  pfp: string;
  size?: number;
}) => {
  return (
    <div className={`flex items-center gap-2 ${styles.unstacked_grid_row1}`}>
      <div >
        <img style={getStyle(pfp, size)} src={pfp} alt="pfp" className="object-cover" />
      </div>
      <span className={`text-content text-[#8E9093]`}>{name}</span>
    </div>
  );
};

export default TutorialCreatedBy;
