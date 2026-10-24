
import React, { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import toast from "react-hot-toast";
import { X } from "lucide-react";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

type Props = {
    title: string;
    onTitleChange: (title: string) => void;
    onCancelCreate: () => void;
    invokeCreateItem: (title: string, createAnother:boolean) => Promise<boolean | "plan-limit">;
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
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)

    useLayoutEffect(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      const resize = () => {
        const maxHeight = parseFloat(getComputedStyle(textarea).lineHeight) * 8
        textarea.style.maxHeight = `${maxHeight}px`
        textarea.style.height = '0px'
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`
      }
      resize()
      if (typeof ResizeObserver === 'undefined') return
      let width = textarea.clientWidth
      const observer = new ResizeObserver(() => {
        if (textarea.clientWidth === width) return
        width = textarea.clientWidth
        resize()
      })
      observer.observe(textarea)
      return () => observer.disconnect()
    }, [title])

    const createItem = async () => {
        const res = schemaCheck()
        if (!res) {
          toast("Cannot create tasks with empty title")
          return
        }
        if (submittingRef.current) return
        submittingRef.current = true
        setIsSubmitting(true)
        let created: boolean | "plan-limit" = false
        try {
          created = await invokeCreateItem(res, true);
        } catch {
          created = false
        } finally {
          submittingRef.current = false
          setIsSubmitting(false)
        }
        if (created === true) onTitleChange('')
        else if (created !== "plan-limit") toast("Could not create the task, try again")
    }

    const schemaCheck = ()=>{
      const trimmedTitle = title.trim();
  
      
      if (trimmedTitle.length > 0) {
        return trimmedTitle;
      } else {
        return false;
      }
    }
  useEffect(()=>{
    document.getElementById("newTask")?.scrollIntoView({behavior:"smooth",block:"center"})
  },[])
    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  return (
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
          className="block border-0 p-0 overflow-x-hidden overflow-y-auto sm:text-content xs:text-emphasis text-white-black font-bold scrollbar-thin scrollbar-thumb-text-light-gray scrollbar-track-kanban-column-scrollbar"
        />
      </div>
      <div
        className="flex items-center justify-end gap-2 mt-2"
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
          aria-label="Close quick entry"
          disabled={isSubmitting}
          onClick={onCancelCreate}
          className={`${MOBILE_TARGET} sm:min-h-0 sm:min-w-0 h-7 w-7 rounded-sm text-text-light-gray hover:bg-hover-active hover:text-white-black disabled:opacity-60`}
        >
          <X size={16} />
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => { void createItem() }}
          className={`${MOBILE_TARGET} sm:min-h-0 sm:min-w-0 h-7 rounded-sm bg-shadcn-primary px-2.5 text-content font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60`}
        >
          Create task
        </button>
      </div>
    </div>
  );
};

export default NewTask;
