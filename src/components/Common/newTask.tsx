/* eslint-disable react-hooks/exhaustive-deps */
import React, { RefObject, useEffect, useRef, useState } from "react";

import toast from "react-hot-toast";

type Props = {
    title: string;
    onTitleChange: (title: string) => void;
    onCancelCreate: () => void;
    invokeCreateItem: (title: string, createAnother:boolean) => Promise<boolean>;
    inputRef: RefObject<HTMLInputElement | null>;
}

// Enter saves and keeps the box open. Clear the title only after the task is
// created, so a failed save never discards what the user typed.
const NewTask = ({
    title,
    onTitleChange,
    inputRef,
    invokeCreateItem,
    onCancelCreate
}: Props) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)

    const createItem = async () => {
        const res = schemaCheck()
        if (!res) {
          toast("Cannot create tasks with empty title")
          return
        }
        if (submittingRef.current) return
        submittingRef.current = true
        setIsSubmitting(true)
        let created = false
        try {
          created = await invokeCreateItem(res, true);
        } catch {
          created = false
        } finally {
          submittingRef.current = false
          setIsSubmitting(false)
        }
        if (created) onTitleChange('')
        else toast("Could not create the task, try again")
    }

    const schemaCheck = ()=>{
      const trimmedTitle = title.trim();
  
      // Check if the trimmed title is not empty
      
      if (trimmedTitle.length > 0) {
        return trimmedTitle;
      } else {
        return false;
      }
    }
  useEffect(()=>{
    document.getElementById("newTask")?.scrollIntoView({behavior:"smooth",block:"center"})
  },[])
  return (
        <div id="newTask" className="rounded-md bg-cardBackground px-3 py-[10px]"  style={{ cursor: 'pointer', width: '100%'}}>
          <input
            ref={inputRef}
            value={title}
            readOnly={isSubmitting}
            aria-busy={isSubmitting}
            autoFocus
            onBlur={() => {
              if (!submittingRef.current) onCancelCreate()
            }}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || isSubmitting) return;
              if (e.key === "Enter") {
                e.preventDefault();
                void createItem();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onCancelCreate()
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
