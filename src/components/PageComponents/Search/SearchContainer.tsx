import React, { useLayoutEffect, useRef, useState } from 'react'
import SearchList from './SearchList'
import { useSearchListContext } from '@/lib/contexts/Search/SearchCompContext'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useRecoilState } from '@/lib/state'
import { SearchTaskIndexAtom } from '@/store'

const SearchContainer = (
  {
    _searchTerm
  }:{
    _searchTerm:string
  }
) => {
  const router = useRouter()
  const tasksInputRef = useRef<HTMLInputElement>(null) 
  const { filteredTasks, setSelectedIndex, selectedIndex} = useSearchListContext()
  const {inputValue, handleChange, noResultsMessage, searchHandle}= useHandleInput(_searchTerm)
  const queryClient = useQueryClient();   
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const [SearchTaskIndex, setSearchTaskIndex] = useRecoilState(SearchTaskIndexAtom);

  const [searchTermFinal, setSearchTermFinal] = useState<string>(_searchTerm??"");

   // -------------------- ON MODAL LOAD
   const onOpenHandler = async()=>{
    document?.getElementById(`task_${selectedIndex}`)?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior, block: 'center' })
    queryClient.invalidateQueries({queryKey:["projectsAll"]});

  }

        // ---------------------------- AVOIDING CONTINIOUS MOUSE MOVEMENT TRACKING ---------------------
        useLayoutEffect(() => {
          router.refresh()
          setSearchTaskIndex(0)
          // window.scrollTo(0,720)
          document?.getElementById(`task_${selectedIndex}`)?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' })
  
          onOpenHandler()
          tasksInputRef.current?.focus()
          return () => {
            // Clear the debounceTimeout when the component unmounts
            if (debounceTimeout.current) {
              clearTimeout(debounceTimeout.current);
            }
          };
  
        }, []);

  return (
    <div className='  p-0 rounded-b-[4px]  '>
      <input
                      id='linksModal'
                      placeholder="Search Tasks"
                      tabIndex={-1}
                      autoFocus
                      onFocus={()=>setSelectedIndex(-1)}
                      autoComplete="off"
                      ref={tasksInputRef}
                      className=" w-full px-16 text-heading text-white-black rounded-b-[4px] font-bold bg-inherit outline-none "
                      value={inputValue}
                      onChange={handleChange}
                      onClick={()=>{
                        setSelectedIndex(-1)
                      }}
                      onKeyDown={(e)=>{
                          if (e.key==="Enter"){
                              searchHandle(inputValue)
                              document.getElementById("linksModal")?.blur()
                          }
                      }}
                      
                      />
                  {noResultsMessage!=="none" && filteredTasks.length===0?
                      <div  className="px-16 my-4">

                        <span className="text-[#8e9093]">
                          {noResultsMessage}
                        </span>
                      </div>
                    :
                      <SearchList/>
                    
                  }
    </div>
  )
}


const useHandleInput = (_searchTerm:string)=>{

    // -------------------- input handlers
    const [inputValue, setInputValue] = useState<string>(_searchTerm??"");
    const [searchTermFinal, setSearchTermFinal] = useState<string>(_searchTerm??"");
    const [timerId, setTimerId] = useState<any>("");
    const [noResultsMessage, setNoResultsMessage] = useState<string|null|undefined>("none");
    const router = useRouter()


    const { selectedIndex, _parsedProjects,setSelectedIndex} = useSearchListContext()

       // =========================== INPUT CHANGE HANDLER
       const handleChange = (e:any)=>{
        setSelectedIndex(-1)
        setInputValue(e.target.value)
        // if (_selectedUrl) setSelectedUrl(null)
        clearTimeout(timerId);
        const newTimerId = setTimeout( async() => {
            // Call the API callback after 2 seconds
           
        
        }, 1000);
        setTimerId(newTimerId);

    }

       // =========================== Search HANDLER
       const searchHandle = async(searchTerm:string)=>{
        if (searchTerm.length<2) return
        setSearchTermFinal(searchTerm)
        // window.history.replaceState({},"",`search?searchTerm=${searchTerm}`)
        router.replace(`search?searchTerm=${searchTerm}&index=${0}`)
  
     
            const response = await axios.post("/api/tasks/searchAll",{
                projectIds : _parsedProjects.map((item,index)=>item.id),
                searchQuery:searchTerm            
            })
            if (response.status===200){
                // setFilteredTasks(response.data)
                if (response.data.length===0) setNoResultsMessage("No Tasks Found")
                else setNoResultsMessage("No Tasks Found")   
            }
            setSelectedIndex(0)

    }
      
    return {inputValue, handleChange, noResultsMessage, searchHandle}
}
export default SearchContainer
