/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/media-has-caption */

import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { resizableMediaActions } from "./resizableMediaMenuUtil";
import { normalizeImageSource } from "@/utils/helperFunctions/normalizeImageSource";
import "./styles.scss";

// Loading spinner component
const Spinner = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 rounded-lg">
    <div className="loader animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white"></div>
  </div>
);

// ! had to manage this state outside of the component because `useState` isn't fast enough and creates problem cause
// ! the function is getting old data even though new data is set by `useState` before the execution of function
let lastClientX: number;

const MAX_HEIGHT = 320;

const calculateProperDimensions = (
  naturalWidth: number,
  naturalHeight: number,
  containerWidth: number = 800,
) => {
  const aspectRatio = naturalWidth / naturalHeight;

  // For landscape images (width > height)
  if (naturalWidth > naturalHeight) {
    // Use container width as constraint, calculate height
    let newWidth = Math.min(naturalWidth, containerWidth);
    let newHeight = Math.round(newWidth / aspectRatio);

    // If calculated height exceeds MAX_HEIGHT, constrain by height instead
    if (newHeight > MAX_HEIGHT) {
      newHeight = MAX_HEIGHT;
      newWidth = Math.round(newHeight * aspectRatio);
    }

    return { width: newWidth, height: newHeight };
  }

  // For portrait images (height > width)
  else if (naturalHeight > naturalWidth) {
    // Use MAX_HEIGHT as constraint, calculate width
    let newHeight = Math.min(naturalHeight, MAX_HEIGHT);
    let newWidth = Math.round(newHeight * aspectRatio);

    // If calculated width exceeds container width, constrain by width instead
    if (newWidth > containerWidth) {
      newWidth = containerWidth;
      newHeight = Math.round(newWidth / aspectRatio);
    }

    return { width: newWidth, height: newHeight };
  }

  // For square images (width === height)
  else {
    const maxDimension = Math.min(MAX_HEIGHT, containerWidth);
    const newSize = Math.min(naturalWidth, maxDimension);
    return { width: newSize, height: newSize };
  }
};

export const ResizableMediaNodeView = ({
  node,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) => {
  const [mediaType, setMediaType] = useState<"img" | "video">();
  const [isLoading, setIsLoading] = useState<boolean>(!!node.attrs.isLoading);
  const [dimensionsCalculated, setDimensionsCalculated] =
    useState<boolean>(false);

  useEffect(() => {
    setMediaType(node.attrs["media-type"]);
    setIsLoading(!!node.attrs.isLoading);
  }, [node.attrs]);

  const [aspectRatio, setAspectRatio] = useState(0);
  const [proseMirrorContainerWidth, setProseMirrorContainerWidth] = useState(0);
  const [mediaActionActiveState, setMediaActionActiveState] = useState<
    Record<string, boolean>
  >({});

  const resizableImgRef = useRef<HTMLImageElement | HTMLVideoElement | null>(
    null,
  );

  const calculateMediaActionActiveStates = () => {
    const activeStates: Record<string, boolean> = {};

    resizableMediaActions.forEach(({ tooltip, isActive }) => {
      activeStates[tooltip] = !!isActive?.(node.attrs);
    });

    setMediaActionActiveState(activeStates);
  };

  useEffect(() => {
    calculateMediaActionActiveStates();
  }, [node.attrs]);

  const mediaSetupOnLoad = () => {
    // ! TODO: move this to extension storage
    const proseMirrorContainerDiv = document.querySelector(".ProseMirror");

    if (proseMirrorContainerDiv)
      setProseMirrorContainerWidth(proseMirrorContainerDiv?.clientWidth);

    // When the media has loaded
    if (!resizableImgRef.current) return;

    if (mediaType === "video") {
      const video = resizableImgRef.current as HTMLVideoElement;

      video.addEventListener("loadeddata", function () {
        const naturalWidth = video.videoWidth;
        const naturalHeight = video.videoHeight;

        setAspectRatio(naturalWidth / naturalHeight);

        if (!dimensionsCalculated) {
          // Pass the container width to the calculation
          const { width, height } = calculateProperDimensions(
            naturalWidth,
            naturalHeight,
            proseMirrorContainerWidth,
          );

          if (
            node.attrs.width !== width.toString() ||
            node.attrs.height !== height.toString()
          ) {
            console.log("Updating video dimensions:", { width, height });
            updateAttributes({
              width: width.toString(),
              height: height.toString(),
            });
          }

          setDimensionsCalculated(true);
        }
      });
    } else {
      resizableImgRef.current.onload = () => {
        // Ref can be null if the node view unmounts before the image loads (HTPR-4734)
        if (!resizableImgRef.current) return;
        const naturalWidth = (resizableImgRef.current as HTMLImageElement)
          .naturalWidth;
        const naturalHeight = (resizableImgRef.current as HTMLImageElement)
          .naturalHeight;

        setAspectRatio(naturalWidth / naturalHeight);

        if (!dimensionsCalculated) {
          // Pass the container width to the calculation
          const { width, height } = calculateProperDimensions(
            naturalWidth,
            naturalHeight,
            proseMirrorContainerWidth,
          );

          const currentWidth = parseInt(node.attrs.width || "0");
          const currentHeight = parseInt(node.attrs.height || "0");

          if (
            currentWidth !== width ||
            currentHeight !== height ||
            currentWidth === 0 ||
            currentHeight === 0
          ) {
            console.log("Updating image dimensions:", {
              from: { width: currentWidth, height: currentHeight },
              to: { width, height },
            });
            updateAttributes({
              width: width.toString(),
              height: height.toString(),
            });
          }

          setDimensionsCalculated(true);
        }
      };
    }

    setTimeout(() => calculateMediaActionActiveStates(), 200);
  };

  const setLastClientX = (x: number) => {
    lastClientX = x;
  };

  useEffect(() => {
    mediaSetupOnLoad();
  });

  // Reset dimensions calculated flag when loading state changes
  useEffect(() => {
    if (!isLoading) {
      setDimensionsCalculated(false);
    }
  }, [isLoading]);

  const [isHorizontalResizeActive, setIsHorizontalResizeActive] =
    useState(false);

  interface WidthAndHeight {
    width: number;
    height: number;
  }

  const limitWidthOrHeightToFiftyPixels = ({ width, height }: WidthAndHeight) =>
    width < 100 || height < 100;

  const documentHorizontalMouseMove = (e: MouseEvent) => {
    setTimeout(() => onHorizontalMouseMove(e));
  };

  const startHorizontalResize = (e: { clientX: number }) => {
    // Don't allow resizing while uploading
    if (isLoading) return;

    setIsHorizontalResizeActive(true);
    lastClientX = e.clientX;

    setTimeout(() => {
      document.addEventListener("mousemove", documentHorizontalMouseMove);
      document.addEventListener("mouseup", stopHorizontalResize);
    });
  };

  const stopHorizontalResize = () => {
    setIsHorizontalResizeActive(false);
    lastClientX = -1;

    document.removeEventListener("mousemove", documentHorizontalMouseMove);
    document.removeEventListener("mouseup", stopHorizontalResize);
  };

  const onHorizontalResize = (
    directionOfMouseMove: "right" | "left",
    diff: number,
  ) => {
    if (!resizableImgRef.current) {
      console.error("Media ref is undefined|null", {
        resizableImg: resizableImgRef.current,
      });
      return;
    }

    const currentMediaDimensions = {
      width: resizableImgRef.current?.width,
      height: resizableImgRef.current?.height,
    };

    const newMediaDimensions = {
      width: -1,
      height: -1,
    };

    if (directionOfMouseMove === "left") {
      newMediaDimensions.width = currentMediaDimensions.width - Math.abs(diff);
    } else {
      newMediaDimensions.width = currentMediaDimensions.width + Math.abs(diff);
    }

    // Only enforce container width limit when shrinking, not when expanding
    if (
      directionOfMouseMove === "left" &&
      newMediaDimensions.width > proseMirrorContainerWidth
    ) {
      newMediaDimensions.width = proseMirrorContainerWidth;
    }

    newMediaDimensions.height = newMediaDimensions.width / aspectRatio;

    if (limitWidthOrHeightToFiftyPixels(newMediaDimensions)) return;

    updateAttributes({
      width: newMediaDimensions.width.toString(),
      height: newMediaDimensions.height.toString(),
    });
  };

  const onHorizontalMouseMove = (e: MouseEvent) => {
    if (lastClientX === -1) return;

    const { clientX } = e;

    const diff = lastClientX - clientX;

    if (diff === 0) return;

    const directionOfMouseMove: "left" | "right" = diff > 0 ? "left" : "right";

    setTimeout(() => {
      onHorizontalResize(directionOfMouseMove, Math.abs(diff));
      lastClientX = clientX;
    });
  };

  const [isFloat, setIsFloat] = useState<boolean>();

  useEffect(() => {
    setIsFloat(node.attrs.dataFloat);
  }, [node.attrs]);

  const [isAlign, setIsAlign] = useState<boolean>();

  useEffect(() => {
    setIsAlign(node.attrs.dataAlign);
  }, [node.attrs]);

  // Get current dimensions with fallbacks
  const currentWidth = node.attrs.width || "300";
  const currentHeight = node.attrs.height || "200";

  // Calculate dynamic maxHeight for CSS - allow expansion beyond MAX_HEIGHT during manual resize
  const dynamicMaxHeight =
    parseInt(currentHeight) > MAX_HEIGHT ? currentHeight : MAX_HEIGHT;

  return (
    <NodeViewWrapper
      as="article"
      className={`
        media-node-view not-prose transition-all ease-in-out w-full
        ${(isFloat && `f-${node.attrs.dataFloat}`) || ""}
        ${(isAlign && `justify-${node.attrs.dataAlign}`) || ""}
        ${isLoading ? "is-loading" : ""}
      `}
    >
      <div className="w-fit flex relative group transition-all ease-in-out">
        {mediaType === "img" && (
          <img
            src={normalizeImageSource(node.attrs.src)}
            ref={resizableImgRef as any}
            className={`rounded-lg ${isLoading ? "opacity-50" : ""}`}
            alt={node.attrs.alt || node.attrs.src}
            style={{
              width: `${currentWidth}px`,
              height: `${currentHeight}px`,
              maxHeight: `${dynamicMaxHeight}px`,
              objectFit: "contain",
            }}
            width={currentWidth}
            height={currentHeight}
          />
        )}

        {mediaType === "video" && (
          <video
            ref={resizableImgRef as any}
            className={`rounded-lg ${isLoading ? "opacity-50" : ""}`}
            controls
            style={{
              width: `${currentWidth}px`,
              height: `${currentHeight}px`,
              maxHeight: `${dynamicMaxHeight}px`,
              objectFit: "contain",
            }}
            width={currentWidth}
            height={currentHeight}
          >
            <source src={node.attrs.src} />
          </video>
        )}

        {/* Loading spinner overlay */}
        {isLoading && <Spinner />}

        {!isLoading && editor.isEditable && (
          <div
            className="horizontal-resize-handle group-hover:bg-black group-hover:border-2 group-hover:border-white"
            title="Resize"
            onClick={({ clientX }) => setLastClientX(clientX)}
            onMouseDown={startHorizontalResize}
            onMouseUp={stopHorizontalResize}
          />
        )}

        {!isLoading && editor.isEditable && (
          <section className="media-control-buttons hidden group-hover:flex">
            {resizableMediaActions.map((btn) => {
              return (
                <button
                  key={btn.tooltip}
                  type="button"
                  className={`btn rounded-none h-8 px-2 ${
                    mediaActionActiveState[btn.tooltip] ? "active" : ""
                  }`}
                  onClick={() =>
                    btn.tooltip === "Delete"
                      ? deleteNode()
                      : btn.action?.(updateAttributes)
                  }
                >
                  <div className="text-subheading">
                    <btn.icon size={18} strokeWidth={1.75} />
                  </div>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </NodeViewWrapper>
  );
};
