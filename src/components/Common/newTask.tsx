/* eslint-disable react-hooks/exhaustive-deps */
import React, { RefObject, useEffect, useRef, useState } from "react";

import toast from "react-hot-toast";

type Props = {
    onCancelCreate: () => void;
    invokeCreateItem: (title: string, createAnother:boolean) => Promise<boolean>;
    inputRef: RefObject<HTMLInputElement | null>;
    position:"top"|"bottom"
}

// Quick entry: Enter always saves and keeps the box open for the next card
// (HTPR-6175). The title only clears once the create actually succeeds, so a
// failed save never loses what was typed.
const NewTask = ({
    inputRef,
    invokeCreateItem,
    onCancelCreate,
    position
}: Props) => {
    const [title, setTitle] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const createItem = async () => {
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
          toast("Cannot create tasks with empty title")
          return
        }
        setIsSubmitting(true)
        const created = await invokeCreateItem(trimmedTitle, true);
        setIsSubmitting(false)
        if (created) setTitle('')
        else toast("Could not create the task, try again")
    }

    const cancelCreate = () => {
        setTitle('')
        onCancelCreate()
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
            disabled={isSubmitting}
            autoFocus
            onBlur={cancelCreate}
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
