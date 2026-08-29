import { IUser } from "@/models/model";
import { cookies } from "next/headers";
import Inbox from "./Inbox";
import { Metadata } from "next";
import { Suspense } from "react";
import { InboxZeroProvider } from "@/lib/contexts/InboxZeroContext";
import { redirect } from "next/navigation";
import getProjectById from "@/utils/controllers/projects/getById";

const parseUserCookie = (userObjString: { value: string }): IUser | null => {
  try {
    return JSON.parse(userObjString.value);
  } catch {
    return null;
  }
};

export async function generateMetadata(
  props: {
    searchParams: Promise<any>;
  }
): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await Promise.resolve(searchParams);
  const projectIdParam = params?.projectId;
  if (!projectIdParam) return { title: "Inbox" };

  const projectId = typeof projectIdParam === "string" ? parseInt(projectIdParam, 10) : NaN;
  if (!Number.isFinite(projectId)) return { title: "Inbox" };

  const cookieStore = await cookies();
  const userObjString = cookieStore.get("nookies_user");
  if (!userObjString?.value) return { title: "Inbox" };

  const userObj = parseUserCookie(userObjString);
  if (!userObj) return { title: "Inbox" };

  const project = await getProjectById(projectId, userObj.id);
  const projectTitle = project?.title ?? project?.name;

  return {
    title: projectTitle ? `Inbox - ${projectTitle}` : "Inbox",
  };
}

export default async function InboxPage(
  props: {
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");
  let previousBoardString = cookieStore.get("previousBoard");
  if (!userObjString) return redirect("/login");

  const userObj = parseUserCookie(userObjString);
  if (!userObj) return redirect("/login");

  let homePageLink = "/";
  let originProject = "";

  if (previousBoardString) {
    const [project, view] = previousBoardString.value.split("|&|");
    const projectId = project.split("-")[1];

    //Set homepage link with previousBoard cookie
    homePageLink = `/project?id=${projectId}${
      view && view !== "undefined" ? `&view=${view}` : ""
    }`;
    originProject = projectId;
  }

  return (
    <InboxZeroProvider>
      <div className="relative min-h-screen inbox-page-shell">
        <div className="relative z-10">
          <Suspense fallback={<>Loading...</>}>
            <Inbox
              currentUser={userObj}
              queryParams={searchParams}
              homepageRouter={homePageLink}
              originProject={originProject}
            />
          </Suspense>
        </div>
      </div>
    </InboxZeroProvider>
  );
}
