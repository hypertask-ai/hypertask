import { cookies } from "next/headers";
import SearchComp from "./SearchComp";
import { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { IUser } from "@/models/model";

export const metadata: Metadata = {
  title: "Search",
};

export default async function Page(
  props: {
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
  }
) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");

  if (!userObjString) {
    return redirect("/login");
  }
  const currentUser: IUser = JSON.parse(userObjString.value);

  const searchTerm: string = searchParams?.searchTerm
    ? searchParams.searchTerm.toString()
    : "";
  const rawIndex = Array.isArray(searchParams?.index)
    ? searchParams?.index[0]
    : searchParams?.index;
  const parsedIndex = rawIndex === undefined ? undefined : Number(rawIndex);
  const initialTabIndex =
    rawIndex === undefined
      ? undefined
      : Number.isInteger(parsedIndex)
        ? parsedIndex
        : 0;
  const rawIncludeArchived = Array.isArray(searchParams?.includeArchived)
    ? searchParams.includeArchived[0]
    : searchParams?.includeArchived;
  const includeArchived = rawIncludeArchived === "1";

  return (
    <Suspense fallback={<>Loading...</>}>
      <SearchComp
        _searchTerm={searchTerm}
        _initialTabIndex={initialTabIndex}
        _includeArchived={includeArchived}
        currentUser={currentUser}
      />
    </Suspense>
  );
}
