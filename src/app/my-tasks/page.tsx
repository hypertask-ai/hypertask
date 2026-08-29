import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import MyTasks from "./MyTasks";
import getMyTasks from "@/utils/controllers/tasks/myTasks";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Tasks",
};

export default async function Page() {
  const cookieStore = await cookies();
  const userObjString: any = cookieStore.get("nookies_user");
  if (!userObjString) {
    return redirect("/login");
  }
  const userObj: IUser = JSON.parse(userObjString.value);
  const { sections, tabs } = await getMyTasks(userObj.id);

  return (
    <Suspense fallback={<>Loading...</>}>
      <MyTasks sections={sections} tabs={tabs} currentUser={userObj} />
    </Suspense>
  );
}
