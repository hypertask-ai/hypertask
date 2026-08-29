import LabelWrapper from "@/components/Labels/LabelWrapper";
import globalConstants from "@/lib/constants";
import { memo } from "react";
import { Circle } from "lucide-react";

const PriorityLabelComponet = ({
  priority,
  flexBasis,
  fontSize,
  py,
  px,
  onClick,
  stopPropogation,
  fontWeight,
  className,
}: {
  priority: any;
  flexBasis?: boolean;
  fontSize?: number;
  py?: number;
  px?: number;
  onClick?: any;
  stopPropogation?: boolean;
  fontWeight?: number;
  className?: string;
}) => {
  const priorityLabel = globalConstants.PriorityConstants.find(
    (prio) => prio.priority_index === priority.priority_index
  );

  if (!priorityLabel) return <></>;

  const handleOnClick = (e: any) => {
    if (!onClick) return;
    e.preventDefault();
    stopPropogation && e.stopPropagation(); // Prevent the click event from propagating to the parent div
    onClick();
  };
  const includeDot = [1, 2]; // high and urgent.
  const typographyStyle = {
    ...(fontSize ? { fontSize } : {}),
    ...(fontWeight ? { fontWeight } : {}),
  };

  return (
    <LabelWrapper
      flexBasis={flexBasis}
      py={py}
      px={px}
      className={className}
      style={typographyStyle}
      onClick={handleOnClick}
    >
      {includeDot.includes(priorityLabel.priority_index) ? (
        <div className={`flex gap-1 items-center  `}>
          <Circle size={7} strokeWidth={1.75}
            style={{ color: priorityLabel?.colorCode }}
            className={`fill-current w-new-notification `}
          />
          <span
            style={typographyStyle}
            className={`h-fit rounded-sm`}
          >
            {priorityLabel?.Priority_Value}
          </span>
        </div>
      ) : (
        <span style={typographyStyle} className={`rounded-sm`}>{priorityLabel?.Priority_Value}</span>
      )}
    </LabelWrapper>
  );
};

export default memo(PriorityLabelComponet);
