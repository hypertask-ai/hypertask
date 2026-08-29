import {  IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { Suspense } from "react";
import Reminders from "./ReminderPageComponent";
import { redirect } from "next/navigation";
// import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Reminders"
}
 

export default async function InboxPage() {


    const cookieStore = await cookies()
    let userObjString:any = cookieStore.get('nookies_user');

    if (!userObjString ){
        return redirect("/login")
    }
    
    const userObj:IUser = JSON.parse(userObjString.value)
      
        return (
          <>
          <Suspense fallback={<>Loading...</>}>
           
             <Reminders
              _currentUser={userObj}
             />
          </Suspense>
          </>
        )
  
    }
