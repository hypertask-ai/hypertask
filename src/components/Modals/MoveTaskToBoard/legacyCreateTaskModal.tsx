import { ModalContainerCustom, ModalHeaderComp, ModalInput } from '@/components/Common/CommonModalComponents';
import { useGetAllProjectsMinimal } from '@/hooks/MultiPages/useGetAllProjectsMinimal';
import { inViewObjectAtom } from '@/store';
import axios from 'axios';
import { useFormik } from 'formik';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ModalBody } from 'reactstrap';
import { useRecoilState } from '@/lib/state';

interface ICreateTask{
    taskTitle: string;
    projectId: number;
    sectionId:number
}
interface IScreens{
    value:0|1|2,
    next:1|2|null,
    prev:0|1|null,
    title:"Select Board" | "Select Column" | "Enter Task Name",
    callback?:(callbackData:number|string)=>void;
    data:any[]|[]|undefined
}

type IProps = {
    closeHTC: () => void;
}
const MoveTaskGlobal = (props:IProps) => {
    const {data:data, isLoading} = useGetAllProjectsMinimal(["projectsAllMinimal"])
    const [inViewObject, __] = useRecoilState(inViewObjectAtom);

    const router = useRouter()
    const [currentScreen, setCurrentScreen] = useState<IScreens>({
        value:0,
        next:1,
        prev:null,
        title:"Select Board",
        data:undefined,
    });

    const [modal, ___] = useState<boolean>(true);
    const [keyboardControls, enableKeyboardControls] = useState<boolean>(false)

    const [redirectingToTask, setRedirectingToTask] = useState<boolean>(false);

    // ==================== initiate Formik
    const formik = useFormik({
        initialValues: {
            taskTitle: "",
            projectId: 0,
            sectionId:0
        },
        
        onSubmit: (values) => {
          handleFormSubmit(values);
        },
      });
    // -------------------- ON MODAL LOAD, for focus
    const onOpenHandler = async()=>{
        // setLoading(true)
        enableKeyboardControls(true) // force focus on input field  
      }
      const handleToggle = () =>{
        // setModal(!modal)
        props.closeHTC()
    }
    // --------------------- form submittion
    const handleFormSubmit = async (values:ICreateTask) => {
        // Your complex form submission logic goes here
        try {
          // Example: Simulating an asynchronous operation
            console.log('Submitting...', values);
            setRedirectingToTask(true)
            //   console.log("🚀 ~ file: index.tsx:58 ~ handleFormSubmit ~ formik.values:", formik.values)
            const body ={
                title:formik.values.taskTitle,
                sectionId:formik.values.sectionId,
                projectId:formik.values.projectId
            }
            const response = await axios.post("/api/tasks/create",body)
            console.log("🚀 ~ file: index.tsx:60 ~ handleFormSubmit ~ response:", response)
            
            if (response.status===200){
                router.refresh()
                console.log('Submission successful!');
                router.push(`/detail/project-${formik.values.projectId}/${response.data.uniqueIndex}`)
                props.closeHTC()
            }
        } catch (error) {
            props.closeHTC()
          console.error('Submission failed:', error);
        }
      };

    //   ================ on receving data set the current screen data 
    useEffect(() => {
        // if user is on first screen, set the data as all projects
        setCurrentScreen({
            value:0,
            next:1,
            prev:null,
            title:"Select Board",
            data:data
        })
    }, [data])

// ========================================== HANDLE ENTER FROM SCREENS FOR CALLBACK ========================
    const handleCallBackFromScreens = (currentScreenValue:number,nextScreenValue:number|null, callbackIndexorString:string|number) => {

        // if callback is from first screen 
        if (currentScreenValue===0){
            formik.setValues({
                ...formik.values, // Spread the existing form values
                projectId:data[callbackIndexorString].id
            })
            setCurrentScreen({
                ...currentScreen,  // Copy existing properties from the previous state
                value:1,
                next:2,
                prev:0,
                title:"Select Column",
                data:data[callbackIndexorString].section
            })
        }
        else if (currentScreenValue===1){
            formik.setValues({
                ...formik.values, // Spread the existing form values
                sectionId:callbackIndexorString as number // in this case we'll just send the sectionId
            })
            setCurrentScreen({
                ...currentScreen,  // Copy existing properties from the previous state
                value:2,
                next:null,
                prev:1,
                title:"Enter Task Name",
                data:[]
            })
        }
        

    }
  
    return (
        <ModalContainerCustom
            fade={false}
            id="estimateModal"
            isOpen={modal}
            show={true} onOpened={onOpenHandler}
            autoFocus={false} 
            toggle={handleToggle}
            className={` sm:max-h-fit`}>

            <ModalHeaderComp  header={redirectingToTask?"Redirecting to Task": currentScreen.title}/>
        {
            !isLoading&& data&& !redirectingToTask&&
                <>
                    {/* ===========  based on the selected screen, show the form and results ==================== */}
                    <FilterableMenuScreen 
                        screenCallback={handleCallBackFromScreens}
                        {...currentScreen}
                                />
                </>
           
                   
        }
      
      </ModalContainerCustom>
    );
}

// export default MoveTaskGlobal;

// this will simply recieve the data and based on that the handlekeydown functios work
// on callback it will simply set the values. 
// the input field is just for filtering. 

interface FilterableMenuScreenProps {
    screenCallback: (currentScreenValue: number, nextScreenValue: number|null,indexOfSelectedRow:string|number) => void;
  }
  
  const FilterableMenuScreen: React.FC<FilterableMenuScreenProps  & IScreens> = ({ title, data, value, next, prev, screenCallback }) => {
    
    // =================== useStates
    const [keyword, setKeyword] = useState<string>("");
    const [selectedIndex, setSelectedIndex] = useState<number>(0)
    const [filteredData, setFilteredData] = useState<typeof data>([])
    // =================== refs
    const currentHoveredDiv = useRef<number | null>(null);
    const teamRef = useRef<HTMLDivElement>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

    // ========================= key down functions =================
    const handleKeyDown = (e: KeyboardEvent) => {
        if ( e.key==="Tab") {
            e.preventDefault()
            return 
        }
        else if (e.key==="Enter" && data){
            if (value===0 && filteredData){
                setKeyword("")
                const indexof = data.findIndex(item=>item.id===filteredData[selectedIndex].id)
                console.log("🚀 ~ file: index.tsx:204 ~ handleKeyDown ~ indexof:", indexof)
                if (indexof>-1) submitForCallback(indexof)
                // screenCallback(value,next, indexof)
            }
            else if (value===1 && filteredData && filteredData[selectedIndex]){
                setKeyword("")
                submitForCallback(filteredData[selectedIndex].id)
            }
            else if (value===2 &&keyword.length>0){
                submitForCallback(keyword)
                setKeyword("")
                // screenCallback(value,next, keyword)

            }

        }
        else if (e.key === "j"  || e.key === "ArrowDown") {
            if(data){
                if (selectedIndex === -1 || selectedIndex === (data.length - 1)) {
                    // setSelectedTeam(filteredTeams[0])
                    // document.getElementById(`inbox-${_notifications[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedIndex(prev=>prev+1)
                    document.getElementById(`command-${selectedIndex + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }
    
            
        }
    
    
        else if (e.key === "k"|| e.key === "ArrowUp") {
            if(data){
                if (selectedIndex <=0) {
                    // setSelectedTeam(filteredTeams[0])
                    // document.getElementById(`inbox-${_notifications[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedIndex(prev=>prev-1)
                    document.getElementById(`command-${selectedIndex - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }
    
        }
      }
      

    // ======================= use for both enter and on click
    const submitForCallback = (callbackData:any, findIndex?:boolean)=>{
        if (data&&findIndex &&filteredData && value===0){
            const indexof = data.findIndex(item=>item.id===filteredData[callbackData].id)
            if (indexof>-1) screenCallback(value,next, indexof)
        }
        else screenCallback(value,next, callbackData)
    }

    const handleMouseEnter = (index: number) => currentHoveredDiv.current = index;
        
    
    const handleMouseLeave = () => {
        // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    
        // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
        debounceTimeout.current = setTimeout(() => {
            if (currentHoveredDiv.current !== null && teamRef.current) {
                (teamRef.current as HTMLDivElement)?.blur();
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

// ============================== clear debouncer on mount
    useEffect(() => {
        return () => {
            // Clear the debounceTimeout when the component unmounts
        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            }
        
        };

        }, []);

// ============================== handle keydown use effect
    useEffect(() => {  
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
        }, [document.activeElement,keyword, selectedIndex,filteredData,value]);

// ============================== onKeyword change
    useEffect(() => {
        if (data && value!==2){

            const filteredData_ = keyword.length > 0 ? data.filter(
                    (item) => 
                            value===0
                            ? item.title.toLowerCase().indexOf(keyword) > -1
                            : item.section_title.toLowerCase().indexOf(keyword) > -1
                        
                        
                        ) : data
            setFilteredData(filteredData_)
            setSelectedIndex(0)
            document.getElementById(`command-0`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }

        }, [keyword])

    useEffect(()=>{
        document.getElementById(`command-0`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        document.getElementById(`input-addTask`)?.focus()
        data&&setFilteredData([...data])
        setSelectedIndex(0)
    },[data])
    return(
        <>
            <ModalBody className='text-white-black p-0 rounded-b-[4px]  '>
                <ModalInput
                    id='input-addTask'
                    // autoFocus
                    // className="py-2 px-6 text-heading h-[60px] w-full  text-white-black bg-[#333B47] border-0 outline-none font-normal"
                    onChange={(e)=>setKeyword(e.target.value)}
                    value={keyword}
                    // autoComplete='off'
                    placeholder={title==="Enter Task Name"?"Task Name":"Search"}
                />
                {
                    value!==2 && filteredData && filteredData.length>0&&
                        <div 
                            onMouseMove={handleMouseMove}  
                            className="max-h-[340px] overflow-y-scroll scrollbar-none">
                            {
                                filteredData?.map((item, index) => {
                                    return (
                                        <div
                                            
                                            onClick={()=>submitForCallback(value===0?index:item.id,value===0?true:false)}
                                            onMouseLeave={handleMouseLeave}
                                            onMouseEnter={()=>handleMouseEnter(index)}
                                            className={`h-[60px] text-white-black cursor-pointer transition-all duration-75 px-6 ${selectedIndex===index?"":"transparent"}`} 
                                            id={`command-${index}`}
                                            key={item.id}
                                            style={{  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span>
                                                {value===0?item.title:item.section_title} 
                                            </span>
                                        </div>
                                    )
                                })
                            }
                        </div>
                        
                }
            </ModalBody>
        </>
    )
}