/* eslint-disable react-hooks/exhaustive-deps */
import React, { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import toast from "react-hot-toast";
import { X } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6873_QUICK_ENTRY_GROW_FLAG } from "@/lib/flags/keys";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

type Props = {
    title: string;
    onTitleChange: (title: string) => void;
    onCancelCreate: () => void;
    invokeCreateItem: (title: string, createAnother:boolean) => Promise<boolean>;
    inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}

const NewTask = ({
    title,
    onTitleChange,
    inputRef,
    invokeCreateItem,
    onCancelCreate
}: Props) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const submittingRef = useRef(false)
    const quickEntryGrow = useFlag(HTPR_6873_QUICK_ENTRY_GROW_FLAG)
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    useLayoutEffect(() => {
      const textarea = textareaRef.current
      if (!quickEntryGrow || !textarea) return
      const resize = () => {
        const maxHeight = parseFloat(getComputedStyle(textarea).lineHeight) * 8
        textarea.style.maxHeight = `${maxHeight}px`
        textarea.style.height = '0px'
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
      }
      resize()
      // Wrapping also changes when the column or viewport width changes.
      if (typeof ResizeObserver === 'undefined') return
      let width = textarea.clientWidth
      const observer = new ResizeObserver(() => {
        if (textarea.clientWidth === width) return
        width = textarea.clientWidth
        resize()
      })
      observer.observe(textarea)
      return () => observer.disconnect()
    }, [title, quickEntryGrow])

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
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || isSubmitting) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void createItem();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancelCreate()
      }
    }

  return quickEntryGrow ? (
    <div
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !submittingRef.current) onCancelCreate()
      }}
    >
      <div id="newTask" className="rounded-md bg-cardBackground px-3 py-[10px]" style={{ cursor: 'pointer', width: '100%' }}>
        <textarea
          ref={(element) => { textareaRef.current = element; inputRef.current = element }}
          rows={1}
          value={title}
          readOnly={isSubmitting}
          aria-busy={isSubmitting}
          aria-label="Title"
          autoFocus
          onChange={(e) => onTitleChange(e.target.value.replace(/[\r\n]+/g, ' '))}
          onKeyDown={onKeyDown}
          style={{ resize: 'none', background: 'transparent', width: '100%', outline: 'none', overflowWrap: 'anywhere' }}
          placeholder="Title"
          className="block border-0 p-0 overflow-x-hidden overflow-y-auto sm:text-content xs:text-emphasis text-white-black font-bold scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-kanban-column-scrollbar"
        />
      </div>
      <div
        className="flex items-center gap-2 mt-2"
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isSubmitting) {
            e.preventDefault()
            e.stopPropagation()
            onCancelCreate()
          }
        }}
      >
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => { void createItem() }}
          className={`${MOBILE_TARGET} sm:min-h-0 sm:min-w-0 h-7 rounded-sm bg-white-black px-2.5 text-content font-medium text-white-black-inverted hover:opacity-90 disabled:opacity-60`}
        >
          Create task
        </button>
        <button
          type="button"
          aria-label="Close quick entry"
          disabled={isSubmitting}
          onClick={onCancelCreate}
          className={`${MOBILE_TARGET} sm:min-h-0 sm:min-w-0 h-7 w-7 rounded-sm text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:opacity-60`}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  ) : (
        <div id="newTask" className="rounded-md bg-cardBackground px-3 py-[10px]"  style={{ cursor: 'pointer', width: '100%'}}>
          <input
            ref={(element) => { inputRef.current = element }}
            value={title}
            readOnly={isSubmitting}
            aria-busy={isSubmitting}
            autoFocus
            onBlur={() => {
              if (!submittingRef.current) onCancelCreate()
            }}
            onChange={(e) => onTitleChange(e.target.value)}
            onKeyDown={onKeyDown}
            style={{ resize: 'none', background: 'transparent', width: '100%', outline: 'none' }}
            placeholder="Title"
            className="sm:text-content xs:text-emphasis text-white-black font-bold"
          />
        </div>
  );
};

export default NewTask;
