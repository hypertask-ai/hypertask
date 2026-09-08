import React, { type RefObject, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

type Props = {
  title: string;
  onTitleChange: (title: string) => void;
  onCancelCreate: () => void;
  invokeCreateItem: (
    title: string,
    createAnother: boolean,
  ) => Promise<boolean>;
  inputRef: RefObject<HTMLInputElement | null>;
};

// Enter saves and keeps the box open. Clear the title only after the task is
// created, so a failed save never discards what the user typed.
const NewTask = ({
  title,
  onTitleChange,
  inputRef,
  invokeCreateItem,
  onCancelCreate,
}: Props) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const createItem = async () => {
    if (submittingRef.current) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast("Cannot create tasks with empty title");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    let created = false;
    try {
      created = await invokeCreateItem(trimmedTitle, true);
    } catch {
      created = false;
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }

    if (created) onTitleChange("");
    else toast("Could not create the task, try again");
  };

  useEffect(() => {
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div
      ref={boxRef}
      className="rounded-md bg-cardBackground px-3 py-[10px]"
      style={{ cursor: "pointer", width: "100%" }}
    >
      <input
        ref={inputRef}
        value={title}
        readOnly={isSubmitting}
        aria-busy={isSubmitting}
        autoFocus
        onBlur={() => {
          if (!submittingRef.current) onCancelCreate();
        }}
        onChange={(event) => onTitleChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || isSubmitting) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void createItem();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancelCreate();
          }
        }}
        style={{
          resize: "none",
          background: "transparent",
          width: "100%",
          outline: "none",
        }}
        placeholder="Title"
        className="sm:text-content xs:text-emphasis text-white-black font-bold"
      />
    </div>
  );
};

export default NewTask;
