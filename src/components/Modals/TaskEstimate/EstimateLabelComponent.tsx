import LabelWrapper from "@/components/Labels/LabelWrapper";
import globalConstants from "@/lib/constants";
import { memo } from "react";

const EstimateLabelComponent = ({
  estimate,
  flexBasis,
  fontSize,
  py,
  px,
  onClick,
  fontWeight,
  className,
}: {
  estimate: any;
  flexBasis?: boolean;
  fontSize?: number;
  py?: number;
  px?: number;
  onClick?: any;
  fontWeight?: number;
  className?: string;
}) => {
  const estimateLabel = globalConstants.EstimateConstants.find(
    (est) => est.estimate_index === estimate.estimate_index
  );

  if (!estimateLabel) return <></>;

  const handleOnClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent the click event from propagating to the parent div
    onClick();
  };
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
      <span
        style={typographyStyle}
      >
        {estimateLabel?.estimate_value}
      </span>
    </LabelWrapper>
  );
};

export default memo(EstimateLabelComponent);
