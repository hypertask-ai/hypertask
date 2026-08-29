import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import Pinned from "./PinnedComp";
import { getAllPinned } from "@/utils/controllers/savedContent/getAllPinned";

export const metadata: Metadata = {
  title: "Pinned",
};

export default async function PinnedPage() {
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");

  if (!userObjString) {
    return redirect("/login");
  }
  const userObj: IUser = JSON.parse(userObjString.value);
  const data = await getAllPinned(userObj.id);

  return (
    <Pinned _savedContent={JSON.stringify(data.json)} currentUser={userObj} />
  );
}
