"use client"
import { ITask } from '@/models/model';
import { showCommandsAtom, tasksPlayListAtom, SearchTaskIndexAtom } from '@/store';
// import { taskBaseUri } from '@/utils';
import { useRouter } from 'next/navigation';
import  { useEffect, useRef, useState } from 'react'
import { useRecoilState } from '@/lib/state';
import { useDeviceContext } from '../deviceContext';

const HandleKeyboardFunctions  = (list:any[]) => {
  const isApple = useDeviceContext()
  const router = useRouter()
  const listLen = list?.length

  const listItemRef = useRef<HTMLDivElement>(null);
  const currentHoveredDiv = useRef<number | null>(null);
  const [SearchTaskIndex, setSearchTaskIndex] = useRecoilState(SearchTaskIndexAtom);

    const [selectedIndex, setSelectedIndex] = useState<number>(SearchTaskIndex??0)
    const [showConfirmation, setShowConfirmation] = useState<boolean>(false)
    const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);
    const [__, setTasksPlayList] = useRecoilState(tasksPlayListAtom);

    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
    const isInputFocused = ['input', 'textarea'].includes((document.activeElement as HTMLElement)?.tagName?.toLowerCase());

    const handleKeyDown = (event:KeyboardEvent)=>{
      var cmdControl = isApple&&event.metaKey || !isApple&&event.ctrlKey;

      console.log("🚀 ~ handleKeyDown ~ event:", event)
      const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]
      if (
        isInputFocused||
        showCommands.show||
          document?.activeElement?.role==="dialog"||
          document?.activeElement?.id==="linksModal"||
          document?.activeElement?.id==="modalButtons"||
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.id === "htc"||
          classNamesToReturnFrom.includes(document?.activeElement?.className)  || 
          document.activeElement?.id === "boardManager" ) return;
          if (event.key === "/"){
            // router.back()
            event.preventDefault()
            setSelectedIndex(-1)
            document.getElementById("linksModal")?.focus()

            return true;
          }
          if (event.key === "/" ) {
            event.preventDefault()
            document.getElementById("linksModal")?.focus()
            // setSelectedUrl(null);
          }
          if (event.key === "Escape") {
            router.back()
            return true;
          }

          if (event.key === "ArrowUp") {
            upHandler();
            return true;
          }

          if (event.key==="Enter"){
            event.preventDefault()
            EnterHandler(list[selectedIndex])
            return true
          }
  
          if (event.key === "ArrowDown") {
            downHandler();
            return true;
          }
  
          //  [#] 
          if ((event.shiftKey && event.keyCode===51)) {
            toggleConfirmation();
            return true;
          }
  

          // [CTRL]/ [E]
          if (event.ctrlKey && event.keyCode===69){
            deleteHandler("recover")
          }

          return false;
    }

    const toggleConfirmation = ()=>setShowConfirmation(prev=>!prev)

    const EnterHandler = async (task:ITask) => {
      const selectedIdx=(selectedIndex + listLen - 1) % listLen

      setSelectedIndex(selectedIdx)
      const tasksPlayList:any = list?.map(task=>({projectId:task.projectId,uniqueIndex:task.uniqueIndex})) 
      setTasksPlayList(tasksPlayList)

      // window.history.replaceState({},"",`search?searchTerm=${searchTermFinal}&index=${idx}`)
      // router.push(`/detail/project-${task.projectId}/${task.uniqueIndex}`)
    }

    const deleteHandler = (mode:"recover"|"delete")=>{
    //   removeFromTrash({
    //       projectId:project.id,
    //       taskId:tasks[selectedIndex].id,
    //       mode
    //     })
      if(selectedIndex===listLen-1) upHandler()
    }

    const upHandler = () => {
        if(selectedIndex===0) return
        const selectedIdx=(selectedIndex + listLen - 1) % listLen
        
        setSelectedIndex(selectedIdx);
        document.getElementById(`task_${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"center", inline:"center"})
  
      };
  
    const downHandler = () => {
        if(selectedIndex===listLen-1) return
        const selectedIdx=(selectedIndex + 1) % listLen

        setSelectedIndex((selectedIndex + 1) % listLen);
        document.getElementById(`task_${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"center", inline:"center"})

    };


    const handleMouseEnter = (index: number) => {
      currentHoveredDiv.current = index;
    };
  
    const handleMouseLeave = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
        debounceTimeout.current = null;
        }

        // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
        debounceTimeout.current = setTimeout(() => {
            if (currentHoveredDiv.current !== null && listItemRef.current) {
            (listItemRef.current as HTMLDivElement)?.blur();
            currentHoveredDiv.current = null;
            }
        }, 100);
        };

    const handleMouseMove = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current && !isInputFocused ) {
            setSelectedIndex(currentHoveredDiv.current?currentHoveredDiv.current:0)
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    };

 

    useEffect(()=>{
      console.log("🚀 ~ HandleKeyboardFunctions ~ list:", list)
      setSelectedIndex(0)
    },[list])

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIndex, listLen, list, handleMouseMove, ]);



    return {selectedIndex ,setSelectedIndex, listItemRef, handleMouseLeave, EnterHandler, handleMouseEnter, handleMouseMove,deleteHandler, showConfirmation, toggleConfirmation}
}

export default HandleKeyboardFunctions