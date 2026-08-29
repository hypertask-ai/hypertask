import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import Archived from "./ArchivedComp";
import tasksGetArchivedTasks from "@/utils/controllers/tasks/getArchivedTasks";
import { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Archive"
}
 
export default async function InboxPage() {


    const cookieStore = await cookies()
    let userObjString:any = cookieStore.get('nookies_user');

    if (!userObjString  ){
        return redirect("/login")
    }
    
    const userObj:IUser = JSON.parse(userObjString.value)

    const data = await tasksGetArchivedTasks(userObj.id, 0, undefined, "active")

      return (
        <>
            <Archived 
                  _archived={JSON.stringify(data.json)}
                  _currentUser={userObj}
            />
        </>
      )
    }
