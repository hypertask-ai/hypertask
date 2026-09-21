import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import styles from "@/styles/FileDragAndDrop.module.scss";
interface FileDragOverlayProps {
  children: React.ReactNode;
  dropCallbackHandler: (droppedFiles: FileList) => void;
  allowDrop: boolean;
  customClassName?: string;
}

const FileDragOverlay: React.FC<FileDragOverlayProps> = ({
  children,
  dropCallbackHandler,
  allowDrop,
  customClassName,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  // The drop listener is registered once, so read the handler through a ref —
  // capturing it in the closure freezes whichever callback existed at mount.
  const dropCallbackRef = useRef(dropCallbackHandler);
  dropCallbackRef.current = dropCallbackHandler;
  const dragCounter = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const componentRef = useRef<HTMLDivElement>(null);

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOut = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setIsDragging(false), 100);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      console.log("File(s) dropped", e.dataTransfer.files);
      dropCallbackRef.current(e.dataTransfer.files);
    }
  }, []);

  useEffect(() => {
    const element = componentRef.current;
    if (element) {
      element.addEventListener("dragenter", handleDragIn);
      element.addEventListener("dragleave", handleDragOut);
      element.addEventListener("dragover", handleDrag);
      element.addEventListener("drop", handleDrop);

      return () => {
        element.removeEventListener("dragenter", handleDragIn);
        element.removeEventListener("dragleave", handleDragOut);
        element.removeEventListener("dragover", handleDrag);
        element.removeEventListener("drop", handleDrop);
      };
    }
  }, [handleDrag, handleDragIn, handleDragOut, handleDrop]);

  if (!allowDrop) return <>{children}</>;

  return (
    <div ref={componentRef} className={styles.container}>
      {children}
      {isDragging && (
        <div className={`${styles.overlay} ${customClassName}`}>
          <div className={styles.content}>
            <UploadIcon />
          </div>
        </div>
      )}
    </div>
  );
};

export default FileDragOverlay;

const UploadIcon = () => {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 24 24"
      fill="white"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 15H14V9H16.5L12 4.5M12 15H10V9H7.5L12 4.5" fill="white" />
      <path
        d="M12 15H14V9H16.5L12 4.5L7.5 9H10V15H12Z"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 19H18"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
