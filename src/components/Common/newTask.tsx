/* eslint-disable react-hooks/exhaustive-deps */
import { RefObject, useEffect, useRef, useState } from "react";

import { useDeviceContext } from "@/lib/contexts/deviceContext";
import toast from "react-hot-toast";

type Props = {
    onCancelCreate: () => void;
    invokeCreateItem: (title: string, createAnother:boolean) => void;
    inputRef: RefObject<HTMLInputElement | null>;
    position:"top"|"bottom"
}

const NewTask = ({
    inputRef,
    invokeCreateItem,
    onCancelCreate,
    position
}: Props) => {
  const isApple = useDeviceContext()

    const [title, setTitle] = useState('')

    const createItem = (createAnother:boolean) => {
        const res =schemaCheck() 
        if (res){
          invokeCreateItem(res, createAnother);
          setTitle('')
        }
        else toast("Cannot create tasks with empty title")
    }

    const cancelCreate = () => {
        setTitle('')
        onCancelCreate()
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
    // position==="top"&&document.getElementById("newTask")?.scrollIntoView({behavior:"smooth" as ScrollBehavior,block:"start"})
  },[])
  return (
        <div id="newTask" className="rounded-md bg-cardBackground px-3 py-[10px]"  style={{ cursor: 'pointer', width: '100%'}}>
          <input
            ref={inputRef}
            value={title}
            onBlur={cancelCreate}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              var cmdControl = isApple&&e.metaKey || !isApple&&e.ctrlKey;
              if (e.key==="Enter" && cmdControl){
                createItem(true)
              }

              // ======= pressing enter
              else if (e.key === "Enter" && title.length > 0) {
                createItem(false);
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
