import LabelWrapper from "@/components/Labels/LabelWrapper";
import React, { useEffect, useRef, useState } from "react";

const TaskLabelComponent = ({
  labelValue,
  flexBasis,
  fontSize,
  py,
  px,
  onClick,
  stopPropogation,
  fontWeight,
  taskDetail = false,
  className,
  nowrap = false,
}: {
  labelValue: string;
  flexBasis?: boolean;
  fontSize?: number;
  py?: number;
  px?: number;
  onClick?: any;
  stopPropogation?: boolean;
  fontWeight?: number;
  taskDetail?: boolean;
  className?: string;
  nowrap?: boolean;
}) => {
  const labelRef = useRef<HTMLDivElement>(null);
  const [overFlowing, setIsOverFlowing] = useState<boolean>(false);
  const handleOnClick = (e: any) => {
    e.preventDefault();
    stopPropogation && e.stopPropagation(); // Prevent the click event from propagating to the parent div
    onClick && onClick();
  };

  useEffect(() => {
    const checkWidth = () => {
      if (labelRef.current && taskDetail) {
        const containerWidth = labelRef.current.getBoundingClientRect().width;
        setIsOverFlowing(containerWidth >= 173);
      }
    };

    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  return (
    <LabelWrapper
      flexBasis={flexBasis}
      py={py}
      px={px}
      className={`${className ?? ""} ${nowrap ? "min-w-0 max-w-[120px] overflow-hidden whitespace-nowrap" : ""}`}
      ref={labelRef}
      onClick={handleOnClick}
    >
      <span
        className={`${
          taskDetail || nowrap
            ? "overflow-hidden whitespace-nowrap text-ellipsis max-w-full"
            : ""
        } relative`}
        style={{
          ...(fontSize ? { fontSize } : {}),
          fontWeight: fontWeight ? fontWeight : 500,
        }}
      >
        {labelValue}
        {taskDetail && taskDetail && overFlowing && (
          <span className="absolute inset-y-0 right-[-2px] w-20 bg-gradient-to-l from-comment-description-border to-transparent pointer-events-none" />
        )}
      </span>
    </LabelWrapper>
  );
};

export default React.memo(TaskLabelComponent);
