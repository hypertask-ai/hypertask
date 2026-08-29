import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAllStarred } from "@/utils/controllers/savedContent/getAllStarred";
import Starred from "./StarredComp";

export const metadata: Metadata = {
  title: "Starred",
};

export default async function StarredPage() {
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");

  if (!userObjString) {
    return redirect("/login");
  }
  const userObj: IUser = JSON.parse(userObjString.value);
  const data = await getAllStarred(userObj.id);

  return (
    <Starred
      _savedContent={JSON.stringify(data.json)}
      currentUser={userObj}
    />
  );
}
