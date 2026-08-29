import React from "react";

const CircularProgressBar = ({
  sqSize = 200,
  percentage = 25,
  strokeWidth = 10,
  className = "",
}) => {
  // SVG centers the stroke width on the radius, subtract out so circle fits in square
  const radius = (sqSize - strokeWidth) / 2;
  // Enclose cicle in a circumscribing square
  const viewBox = `0 0 ${sqSize} ${sqSize}`;
  // Arc length at 100% coverage is the circle circumference
  const dashArray = radius * Math.PI * 2;
  // Scale 100% coverage overlay with the actual percent
  const dashOffset = dashArray - (dashArray * percentage) / 100;

  return (
    <svg
      className={className}
      width={sqSize}
      height={sqSize}
      // viewBox={viewBox}
      // shape-rendering="crispEdges"
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
        // Start progress marker at 12 O'Clock
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
