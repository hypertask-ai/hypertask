import formatDateDifference from '@/utils/generateTime';
import { convertToPlain } from '@/utils/helperFunctions/helperFunctions';
import React from 'react'
import { Check } from "lucide-react";
import styles from '@/styles/search.module.scss'
import { useSearchListContext } from '@/lib/contexts/Search/SearchCompContext';
import { IProject, ITask } from '@/models/model';


const SearchList = (
    // {
    //     filteredTasks,
    //     _parsedProjects
    // }:{
    //     filteredTasks: ITask[];
    //     _parsedProjects:IProject[]
    // }
) => {

    const {listItemRef, filteredTasks, _parsedProjects, handleMouseMove, handleMouseEnter, handleMouseLeave, selectedIndex, EnterHandler} = useSearchListContext()

    return (
      <>
      <ul id="users-list" ref={listItemRef} 
                      onMouseMove={handleMouseMove}
                      className="rounded-b-[4px] mt-3  px-16 text-content text-gray-200 overflow-y-auto scrollbar-none " 
                      aria-labelledby="assignDelayButton">
                      {
 
                      filteredTasks?.map((task: ITask, index: number) => {
                        const project = _parsedProjects.find((project:IProject) => project.id === task.projectId);
                        return(
                          <li
                          suppressHydrationWarning
                              id={`task_${index}`} 
                              onMouseEnter={() => handleMouseEnter(index)}
                              onMouseLeave={handleMouseLeave}
                              key={index} 
                              className={` font-medium  border-l-4 
                                  transition-colors
                                  px-4 rounded-md 
                                  ease-linear duration-100
                                  flex py-2 items-center gap-3 cursor-pointer  ${styles.list_container} 
                                  ${(filteredTasks[selectedIndex]?.id && filteredTasks[selectedIndex]?.id === task.id) ? "bg-[#363A40]   border-white":"border-transparent"}`} 
                              onClick={() => EnterHandler(task)}
                              >
                              
                              <span>
                                {project?.title??`project-${project?.id}`}
                              </span>               
                              <span className="font-bold truncate line-clamp-1">
                                {task.title}
                              </span>          
                              <span suppressHydrationWarning className={`${styles.links_list} text-[#8E9093] font-bold`}>
                              { typeof window !== 'undefined' && 
                              
                                  convertToPlain(task.description??"") 
                                  
                              }
                              </span>

                              <span suppressHydrationWarning className="justify-self-end">
                                {task.status==="Normal"&& <Check size={16} color="white" strokeWidth={1.75}/>}
                                {task.status==="Archive"&& <Check size={16} color="green" strokeWidth={1.75}/>}
  
                                  {/* <AiOutlineCheck color="#5896F1" strokeWidth={90}/>} */}
                              </span>

                              <span className="text-[#8E9093] justify-self-end">
                                
                                {task.createdAt?
                                  formatDateDifference(task.createdAt)
                                  :
                                  formatDateDifference(task.archivedAt!)}
                              </span>                         
                              {/* {section.visibility===false && <AiFillEyeInvisible/>} */}
                          </li>
                          )
                                })
                        
                        }

                  </ul>    
    </>
)
}

export default SearchList
