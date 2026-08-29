import { ILog, IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { Suspense } from "react";
import getAllLogs from "@/utils/controllers/logs/getAllLogs";
import Logs from "./Logs";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Logs"
}
 

export default async function InboxPage() {


    const cookieStore = await cookies()
    let userObjString:any = cookieStore.get('nookies_user');

    if (!userObjString ){
        return redirect("/login")
    }
    
    const userObj:IUser = JSON.parse(userObjString.value)
    if ([4,6].includes(userObj.id)){
      
      const allLogs:ILog[] = await (await getAllLogs()).json
        return (
          <>
          <Suspense fallback={<>Loading...</>}>
           
             <Logs
              logs={allLogs}
             />
          </Suspense>
          </>
        )
    }
    else {
      redirect("/")
    }
    }
