/* eslint-disable react-hooks/exhaustive-deps */
import { Calendar } from "@/components/Common/Calendar"
import { ModalContainerCustom, ModalHeaderComp, ModalInput, ModalListContainer, ModalRowElementContainer } from "@/components/Common/CommonModalComponents"
import useHandleMouseGlobal from "@/hooks/General/useHandleMouse"
import {  format,  } from "date-fns"
import { ChangeEvent,  useEffect, useMemo, useState } from "react"
// import { DateRange } from "react-day-picker"
import { ModalBody } from "reactstrap"
// import { DisplayDate } from "../../RemindMe/RemindMeComponent"
import { inputChange } from "@/utils/helperFunctions/dateParse"
import formatDateDifference from "@/utils/generateTime"
// import { IValuePropUpdatedAt, TFilter } from "@/models/Filters/model"
import { useRecoilState } from "@/lib/state"
import {  inViewObjectAtom, lastUsedDueDateAtom } from "@/store"
// import { Button } from "@/components/Buttons/ShadcnButton"
import toast from "react-hot-toast"
import Tooltip from "@/components/Common/Tooltip"
// import { useGetPriorityForTask } from "@/hooks/MultiPages/useGetPriorityForTask"
import { useGetSingleTask } from "@/hooks/MultiPages/Tasks/useGetTask"
import { setDueDateApiHandler } from "@/utils/api/Task Detail"
import { defaultHour, defaultMinutes } from "@/lib/constants/constants"
import useGetTimeOptions from "@/hooks/General/useGetTimeOptions"
import { LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT } from "@/lib/tutorial/learnTutorialState"

const publishDueDateSaved = (taskId:number, result:unknown) => {
  if (result === undefined) return
  window.dispatchEvent(new CustomEvent(LEARN_TUTORIAL_DUE_DATE_SAVED_EVENT, {
    detail: { taskId },
  }))
}

type TScreens = "Custom" | "Sugar"
type TMode= "Create" | "Update"

interface Props {
  closeHandler: (callback: Date|null, reset?:boolean) => void;
  dueDate?: Date ;
  mode: TMode;
  // isActive?:Date|undefined;
}

interface IScreenProps {
  closebackHandler: (payload: any, back?:boolean) => void;
  isActive?:Date|undefined;
  mode: TMode;
}

const DueDateModal:React.FC<Props> = ({closeHandler, dueDate, mode}) => {
  const [inViewObject,__] = useRecoilState(inViewObjectAtom);
  const {data:task}=useGetSingleTask(inViewObject.taskId)
  const currentDate=mode==="Create"?dueDate:(task.dueDate??null)
  
  const [selectedScreen, setSelectedScreen] = useState<TScreens>("Sugar");

  const callbackToSwitchScreen = (screen: TScreens) => setSelectedScreen(screen)

  const closebackHandler = (payload: any, back?:boolean) => {
    if (selectedScreen === "Custom"){
      if (back) callbackToSwitchScreen("Sugar")
      else closeHandler(payload)
    } 
    else if (selectedScreen === "Sugar") {
    console.log("🚀 ~ closebackHandler ~ payload:", payload)
      if (!payload.data&& payload.display==="Reset")closeHandler(null,true)
      // meaning we want to switch screens  
      else if (!payload.date) {
        callbackToSwitchScreen("Custom")
      }

      else if (payload.date) {
        closeHandler(payload.date)
        
      }
    }
  }

  const handleKeyDown = (e:any)=>{
    if (e.key==="Escape"){
        closeHandler(currentDate)
    }
  }
    useEffect(() => {

        // Add event listeners when the component mounts
        document.addEventListener('keydown', handleKeyDown);

        // Remove event listeners when the component unmounts
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [currentDate]);

    
  return (
    <>
      <ModalContainerCustom
        // fade={false}
        key={currentDate?.toString()}
        id="calendar-picker"
        isOpen={true}
        // fullScreen={true}
        toggle={() => closeHandler(currentDate)}
        keyboard={false}
        shouldCloseOnClickOutside={true}
        backdrop="static"
        className="paletteModalSizing xs:max-h-full sm:min-w-[560px] sm:top-[24%] sm:max-h-[520px]"
      >

        <ModalHeaderComp header={`Due date`}>
            {selectedScreen === "Custom" && <span className="text-content text-text-light-gray whitespace-nowrap">SHIFT+ESC to go back</span>}
        </ModalHeaderComp>
        <ModalBody className='p-0 rounded-b-[4px]'>
          {
            selectedScreen === "Custom"
              ?
              <CustomCalendarScreen isActive={currentDate}  closebackHandler={closebackHandler} mode={mode}/>
              :
              <SugarDateScreen key={currentDate} isActive={currentDate}  closebackHandler={closebackHandler} mode={mode}/>
          }
        </ModalBody>
      </ModalContainerCustom>
    </>

  )

}

const CustomCalendarScreen: React.FC<IScreenProps> = ({ closebackHandler,isActive, mode }) => {
  const [inViewObject,__] = useRecoilState(inViewObjectAtom);
  const [date, setDate] = useState<Date| undefined>(isActive??new Date())
  const [, setLastUsedDueDate] = useRecoilState(lastUsedDueDateAtom)

  const onClickHandler = ()=>{

    if (!date) toast("Please select a date first!")
    else{
      date.setHours(defaultHour,defaultMinutes,0)
      if (mode && mode==="Update" && inViewObject.taskId) {
        const taskId = inViewObject.taskId
        void setDueDateApiHandler(date, taskId).then((result) =>
          publishDueDateSaved(taskId, result)
        )
      }
      setLastUsedDueDate({ display: "last used", date: date.toISOString() })
      closebackHandler(date)
    }
  }

  const goBack =()=>closebackHandler(date, true)
  
  return (
    <div
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === "Enter") {
          return setTimeout(() => {
            closebackHandler(date)
          }, 1);
        }
        else if (e.shiftKey && e.key==="Escape"){
            e.preventDefault();
            goBack()
        }
      }}
    >

      <span className="px-4">

        {date ? (
            <>{format(date, "LLL dd, y")}</>
          
        ) : (
          <span>Pick a date</span>
        )}
      </span>
      <Calendar
        initialFocus
        mode="single"
        defaultMonth={date}
        selected={date}
        onSelect={setDate}
        numberOfMonths={2}
      />
      <div className="flex px-4 gap-1 py-1 justify-end">
        <div className="inline-flex cursor-pointer items-center text-dense text-text-light-gray hover:text-white-black" onClick={goBack}>
          Back
        </div>
        <div className="relative group inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm px-3 text-dense font-medium bg-label-span text-white-black hover:bg-hover-active border-0"  onClick={onClickHandler}>
          Confirm
          <Tooltip 
            left={-44}
            bottom={-40}
            text='Confirm Selection'
            keyCombination={['CTRL', "E"]}
            />
        </div>
      </div>
    </div>
  )
}

const SugarDateScreen: React.FC<IScreenProps> = ({ closebackHandler,isActive, mode }) => {

  const { keyword, handleInputChange, selectedIndex, setSelectedIndex, filteredOptions, enterHandler } = useCustomSugar(closebackHandler, isActive, mode);
  const { handleMouseEnter, handleMouseLeave, handleMouseMove, elRef } = useHandleMouseGlobal({ setSelectedIndex })

  return (
    <>

      <ModalInput
        id="filter-input"
        value={keyword}
        placeholder="e.g. tomorrow, next week tuesday ..."
        onChange={handleInputChange} />
      <ModalListContainer className="max-h-[364px]"
        handleMouseMove={handleMouseMove}
        id="filteredCommandsList">
        {filteredOptions?.map((option, index) =>

          <ModalRowElementContainer
            key={index}
            onMouseEnter={()=>handleMouseEnter(index)}
            handleMouseLeave={handleMouseLeave}
            onClick={enterHandler}
            id={`label-htc-option-${index}`}
            index={index} commandRef={elRef} isSelected={selectedIndex === index}
          >
            <span>
              {option?.display}
            </span>
            {
              option?.date &&

              <span>
                {formatDateDifference(option?.date, true)}
              </span>
            }

          </ModalRowElementContainer>
        )}
      </ModalListContainer>
    </>
  )
}

const useCustomSugar = (closebackHandler: (payload: any) => void, isActive:Date|undefined, mode?: TMode) => {
  // const [currentProject, _] = useRecoilState(currentProjectAtom);
  const [inViewObject,__] = useRecoilState(inViewObjectAtom);
  const [lastUsedDueDate, setLastUsedDueDate] = useRecoilState(lastUsedDueDateAtom)
  const { getDueDateOptions } = useGetTimeOptions()
  const customDateRangeOption = { display: "Pick a custom date", date: undefined }
  //okay so if the time is greater than 12AM but less than 9PM, i want it to be
  const defaultOptions: any[] = useMemo(()=>getDueDateOptions(isActive, lastUsedDueDate),[])

  const [keyword, setKeyword] = useState("");
  
  
  const [filteredOptions, setFilteredOptions] = useState<any[]>(defaultOptions);

  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const filterCommandsLen = useMemo(() => filteredOptions.length, [filteredOptions])

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {

    const input = event.target.value;
    setKeyword(input);
    setSelectedIndex(0)

    const final: any = inputChange(input, { past: false, future:true })
    console.log("🚀 ~ handleInputChange ~ final:", final)
    final.push(customDateRangeOption)
    const setToThis = (input.length === 0) ? defaultOptions : final// not my proudest
    console.log("🚀 ~ handleInputChange ~ defaultOptions:", defaultOptions)
    console.log("🚀 ~ handleInputChange ~ setToThis:", setToThis)
    setFilteredOptions(setToThis);
  };

  const handleCommandSelect = (commandIndex: number) => {
    setSelectedIndex(commandIndex);
    document.getElementById(`label-htc-option-${commandIndex}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const upHandler = () => {
    if (selectedIndex === 0) return
    const selectedIdx = (selectedIndex + filterCommandsLen - 1) % filterCommandsLen
    handleCommandSelect(selectedIdx)

  };

  const downHandler = () => {
    if (selectedIndex === filterCommandsLen - 1) return
    const selectedIdx = (selectedIndex + 1) % filterCommandsLen
    handleCommandSelect(selectedIdx)

  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" || event.keyCode === 75) {
      upHandler();
      return true;
    }

    if (event.key === "ArrowDown" || event.keyCode === 74) {
      downHandler();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault()

      enterHandler(selectedIndex);
      return true;
    }
    return false;
  }

  const enterHandler = (index: number) => {
    const selectedLabel = filteredOptions[index]
    if (mode && mode==="Update" && inViewObject.taskId) {
      const taskId = inViewObject.taskId
      void setDueDateApiHandler(selectedLabel.date, taskId).then((result) =>
        publishDueDateSaved(taskId, result)
      )
    }
    if (selectedLabel.date) setLastUsedDueDate({ display: "last used", date: selectedLabel.date })
    setTimeout(() => {
      closebackHandler(selectedLabel)
    }, 1);

  }

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [selectedIndex, filteredOptions, filterCommandsLen, handleKeyDown, isActive]);

  return {
    handleInputChange, keyword, filteredOptions, selectedIndex, setSelectedIndex, enterHandler
  }

}

export default DueDateModal
