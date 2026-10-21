import React from "react";

const CircularProgressBar = ({
  sqSize = 200,
  percentage = 25,
  strokeWidth = 10,
  className = "",
}) => {
  const radius = (sqSize - strokeWidth) / 2;
  const viewBox = `0 0 ${sqSize} ${sqSize}`;
  const dashArray = radius * Math.PI * 2;
  const dashOffset = dashArray - (dashArray * percentage) / 100;

  return (
    <svg
      className={className}
      width={sqSize}
      height={sqSize}
      xmlns="http://www.w3.org/2000/svg"
      vectorEffect="non-scaling-stroke"
    >
      <circle
        className="stroke-current text-white-blackfill-transparent circle-background"
        cx={sqSize / 2}
        cy={sqSize / 2}
        shapeRendering={"geometricPrecision"}
        strokeLinecap="round"
        r={radius}
        strokeWidth={`${strokeWidth}px`}
      />
      <circle
        shapeRendering={"geometricPrecision"}
        className="stroke-current text-sky-500 fill-transpatext-header-hover-textrent circle-progress"
        cx={sqSize / 2}
        cy={sqSize / 2}
        r={radius}
        strokeLinecap="round"
        strokeWidth={`${strokeWidth}px`}
        transform={`rotate(-90 ${sqSize / 2} ${sqSize / 2})`}
        style={{
          strokeDasharray: dashArray,
          strokeDashoffset: dashOffset,
        }}
      />
    </svg>
  );
};

export default CircularProgressBar;
