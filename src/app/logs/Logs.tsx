"use client"

import { ILog } from "@/models/model";
import formatDateDifference from "@/utils/generateTime";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

interface LogsProps {
    logs: ILog[];
  }

  
const Logs: React.FC<LogsProps> = ({ logs })  => {
    const [groupedLogs, setGroupedLogs] = useState<{ [key: string]: ILog[] }>({});
    const [selectedDay, setSelectedDay] = useState<string>()

    useEffect(() => {
        // Helper function to group logs by day
        const groupLogsByDay = (logsArray: typeof logs) => {
          return logsArray.reduce((acc, log) => {
            const date = new Date(log.createdAt).toISOString().split('T')[0];
            if (!acc[date]) {
              acc[date] = [];
            }
            acc[date].push(log);
            return acc;
          }, {} as { [key: string]: ILog[] });
        };
    
        // Update groupedLogs when the logs prop changes
        setGroupedLogs(groupLogsByDay(logs));
        setSelectedDay(logs[0].createdAt.toISOString().split('T')[0])
      }, [logs]);
    return (

        <>
        <div
            className='flex items-center justify-center flex-col w-full min-h-fit bg-dark-background'>
            <div className={`w-full max-w-[1440px] min-h-screen  py-9 px-16 flex flex-col items-start  bg-[#212429]`}>
        
                    {/* <p style={{ fontSize: '24px' }}>Comments</p> */}
                    <div className='hidden sm:flex  sm:gap-8 w-100  h-20 sm:h-8  overflow-x-auto scrollbar-none no-scrollbar font-bold mb-3' >
                        
                        {
                        selectedDay&& Object.keys(groupedLogs).map((day,index)=>
                            <>
                            <div 
                                id={`day-${index}`} 
                                className={`cursor-pointer whitespace-nowrap  text-subheading  flex items-center gap-1 ${selectedDay!==day?"text-[#8E9093]":"text-white"}`} 
                                onClick={()=>setSelectedDay(day)}
                                >
                                <h2  
                                    className='footer_tags'>
                                        {day.length === 1 ?  "All" : convertToDateMonthYear(day)} 
                                </h2>
                        
                            </div>
                                
                            </>

                            )
                        }
                    </div>

                    
                    {selectedDay&&groupedLogs[selectedDay].map((log) => (
                                <div 
                                    className="flex justify-between w-full py-2 font-normal gap-2  border-b border-[#8E9093]"
                                    key={log.id} 
                                    >
                                        <div className="flex gap-3">
                                            <span className="">
                                                {log.log} 
                                                {/* at{' '} */}
                                                {/* <span className="underline text-[#6b7cd9]">{getHoursAndMinutes(log.createdAt.toISOString())}</span> */}
                                            </span>
                                  
                                        </div>
                                        <p className="whitespace-nowrap">{formatDateDifference(log.createdAt.toString())}</p>
                                    {/* Render other properties of your log object as needed */}
                                </div>
                            ))}

        
            </div>

        </div>

        <Link className="goback_btn " href={"/"} style={{ cursor: 'pointer', position: 'fixed', zIndex: 9999, top: 40, left: 40, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#212429' }}>
                    <ArrowLeft size={18} color='white' strokeWidth={1.75} />
          </Link>

        </>   
    );
}

export default Logs;

const convertToDateMonthYear = (inputString:string)=>{
    const dateObject = new Date(inputString);

    const options: Intl.DateTimeFormatOptions = {  month: 'long', day: 'numeric', year: 'numeric' };
    const formattedDate: string = dateObject.toLocaleDateString('en-US', options);
    return formattedDate
}

const getHoursAndMinutes = (inputString:string)=>{
    const dateObject: Date = new Date(inputString);
    console.log("🚀 ~ file: Logs.tsx:110 ~ getHoursAndMinutes ~ inputString:", inputString)
    const options: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      };
      
      const formattedTime: string = dateObject.toLocaleString('en-US', options);
      return formattedTime
}
