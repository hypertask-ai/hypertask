import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AllTasks from "./AllTasks";
import getRecentTasks from "@/utils/controllers/tasks/recentTasks";
import prisma from "@/lib/prisma";
import {
  DEFAULT_ALL_TASKS_DATE_RANGE,
  isAllTasksDateRange,
} from "@/lib/configs/allTasks.config";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "All tasks",
};

export default async function Page() {
  const cookieStore = await cookies();

  let userObjString: any = cookieStore.get("nookies_user");

  if (!userObjString) {
    return redirect("/login");
  }
  const userObj: IUser = JSON.parse(userObjString.value);
  // The chosen range lives on the account so every device opens the same view.
  // Null (never chosen) falls back to the Last-7-days default.
  const setting = await prisma.userSetting.findUnique({
    where: { userId: userObj.id },
    select: { allTasksDateRange: true },
  });
  const dateRange = isAllTasksDateRange(setting?.allTasksDateRange)
    ? setting.allTasksDateRange
    : DEFAULT_ALL_TASKS_DATE_RANGE;
  const { All, tabs } = await getRecentTasks(userObj.id, "All", dateRange);

  return (
    <Suspense fallback={<>Loading...</>}>
      <AllTasks
        _allData={All}
        tabs={tabs as any}
        currentUser={userObj}
        dateRange={dateRange}
      />
    </Suspense>
  );
}
