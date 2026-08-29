/* eslint-disable react-hooks/exhaustive-deps */
"use client"
import useUpdateTrash from '@/hooks/Trash/useUpdateTrash';
import { ITask ,IProject} from '@/models/model';
import { useRouter } from 'next/navigation';
import React, { useEffect, useRef, useState } from 'react'

const HandleKeyboardFunctions  = (tasks:ITask[], project:IProject)=>{
  const taskRef = useRef<HTMLDivElement>(null);

    const taskLen = tasks?.length
    const [selectedIndex, setSelectedIndex] = useState<number>(0)
    const [showConfirmation, setShowConfirmation] = useState<boolean>(false)
    const router = useRouter()

    const {removeFromTrash}= useUpdateTrash()
    const currentHoveredDiv = useRef<number | null>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

    const handleKeyDown = (event:KeyboardEvent)=>{
          if (event.key === "Escape") {
            router.back()
            return true;
          }

        if (event.key === "ArrowUp" || event.keyCode===75) {
            upHandler();
            return true;
          }
  
          if (event.key === "ArrowDown" || event.keyCode===74) {
            downHandler();
            return true;
          }
  
          //  [#] 
          if ((!event.ctrlKey&& event.shiftKey && event.keyCode===51)) {
            // toggleConfirmation();
            deleteHandler("recover") // recover task with # and don't prompt
            return true;
          }
  

          // [CTRL]/ [E]
          if (event.ctrlKey && event.shiftKey  && event.keyCode===51){
            deleteHandler("delete")
          }

          // return false;
    }

    const toggleConfirmation = ()=>setShowConfirmation(prev=>!prev)

    const deleteHandler = async(mode:"recover"|"delete")=>{
      await removeFromTrash({
          projectId:project.id,
          taskId:tasks[selectedIndex].id,
          mode
        })
      if(selectedIndex===taskLen-1) upHandler()
    }

    const upHandler = () => {
        if(selectedIndex===0) return
        const selectedIdx=(selectedIndex + taskLen - 1) % taskLen
        
        setSelectedIndex(selectedIdx);
        document.getElementById(`trash-${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"})
  
      };
  
    const downHandler = () => {
        if(selectedIndex===taskLen-1) return
        const selectedIdx=(selectedIndex + 1) % taskLen

        setSelectedIndex((selectedIndex + 1) % taskLen);
        document.getElementById(`trash-${selectedIdx}`)?.scrollIntoView({behavior:"smooth", block:"nearest", inline:"center"})

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
            if (currentHoveredDiv.current !== null && taskRef.current) {
            (taskRef.current as HTMLDivElement)?.blur();
            currentHoveredDiv.current = null;
            }
        }, 100);
        };

    const handleMouseMove = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            setSelectedIndex(currentHoveredDiv.current?currentHoveredDiv.current:0)
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    };


    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectedIndex, taskLen, tasks]);



    return {selectedIndex, taskRef, handleMouseLeave, handleMouseEnter, handleMouseMove,deleteHandler, showConfirmation, toggleConfirmation}
}

export default HandleKeyboardFunctions