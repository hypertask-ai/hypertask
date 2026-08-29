import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import getRecentTasks from "@/utils/controllers/tasks/recentTasks";
import { Metadata } from "next";
import AllDueDates from ".";

export const metadata: Metadata = {
  title: "Tasks with Due Dates",
};

export default async function Page() {
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");
  if (!userObjString) {
    return redirect("/login");
  }
  const userObj: IUser = JSON.parse(userObjString.value);

  const { All, tabs } = await getRecentTasks(userObj.id, "DueDate");

  return (
    <Suspense fallback={<>Loading...</>}>
      <AllDueDates _allData={All} tabs={tabs as any} />
    </Suspense>
  );
}
