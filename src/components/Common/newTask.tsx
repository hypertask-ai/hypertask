/* eslint-disable react-hooks/exhaustive-deps */
import React, { RefObject, useEffect, useRef, useState } from "react";

import toast from "react-hot-toast";

type Props = {
    initialTitle?: string;
    onCancelCreate: (title: string) => void;
    invokeCreateItem: (title: string, createAnother:boolean) => Promise<boolean>;
    inputRef: RefObject<HTMLInputElement | null>;
}

// Quick entry: Enter always saves and keeps the box open for the next card
// (HTPR-6175). The title only clears once the create actually succeeds, so a
// failed save never loses what was typed.
const NewTask = ({
    initialTitle = "",
    inputRef,
    invokeCreateItem,
    onCancelCreate
}: Props) => {
    const [title, setTitle] = useState(initialTitle)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)

    const createItem = async () => {
        if (submittingRef.current) return
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
          toast("Cannot create tasks with empty title")
          return
        }
        submittingRef.current = true
        setIsSubmitting(true)
        let created = false
        try {
          created = await invokeCreateItem(trimmedTitle, true);
        } catch {
          created = false
        } finally {
          submittingRef.current = false
          setIsSubmitting(false)
        }
        if (created) setTitle('')
        else toast("Could not create the task, try again")
    }

    const cancelCreate = () => {
        onCancelCreate(title)
    }

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    boxRef.current?.scrollIntoView({behavior:"smooth",block:"center"})
  },[])
  return (
        <div ref={boxRef} className="rounded-md bg-cardBackground px-3 py-[10px]"  style={{ cursor: 'pointer', width: '100%'}}>
          <input
            ref={inputRef}
            value={title}
            readOnly={isSubmitting}
            aria-busy={isSubmitting}
            autoFocus
            onBlur={() => {
              if (!submittingRef.current) cancelCreate()
            }}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || isSubmitting) return;

              // ======= pressing enter saves and keeps the box open
              if (e.key === "Enter") {
                e.preventDefault();
                void createItem();
              }

              // esc to cancel add new item
              if (e.key === "Escape") {
                e.preventDefault();
                cancelCreate()
              }
            }}
            style={{ resize: 'none', background: 'transparent', width: '100%', outline: 'none' }}
            placeholder="Title"
            className="sm:text-content xs:text-emphasis text-white-black font-bold"
          />
        </div>
  );
};

export default NewTask;
