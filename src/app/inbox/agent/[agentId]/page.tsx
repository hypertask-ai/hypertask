import { IUser } from "@/models/model";
import { cookies, headers } from "next/headers";
import { Metadata } from "next";
import { Suspense } from "react";
import { InboxZeroProvider } from "@/lib/contexts/InboxZeroContext";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import AgentInbox from "../AgentInbox";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const parseUserCookie = (userObjString: { value: string }): IUser | null => {
  try {
    return JSON.parse(userObjString.value);
  } catch {
    return null;
  }
};

export async function generateMetadata(
  props: {
    params: Promise<{ agentId: string }>;
  }
): Promise<Metadata> {
  const params = await props.params;
  const cookieStore = await cookies();
  const userObjString = cookieStore.get("nookies_user");
  if (!userObjString?.value) return { title: "Agent Inbox" };

  const userObj = parseUserCookie(userObjString);
  const userId = (await getSessionUser(new Headers(await headers())))?.userId;
  if (
    !userObj ||
    !Number.isInteger(userObj.id) ||
    typeof userId !== "number" ||
    userObj.id !== userId
  ) {
    return { title: "Agent Inbox" };
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.agentId, userId },
    select: { displayName: true },
  });

  return {
    title: agent ? `${agent.displayName} Inbox` : "Agent Inbox",
  };
}

export default async function AgentInboxPage(
  props: {
    params: Promise<{ agentId: string }>;
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");
  let previousBoardString = cookieStore.get("previousBoard");
  if (!userObjString) return redirect("/login");

  const userObj = parseUserCookie(userObjString);
  const userId = (await getSessionUser(new Headers(await headers())))?.userId;
  if (
    !userObj ||
    !Number.isInteger(userObj.id) ||
    typeof userId !== "number" ||
    userObj.id !== userId
  ) {
    return redirect("/login");
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.agentId, userId },
  });

  if (!agent) return redirect("/inbox");

  let homePageLink = "/";
  let originProject = "";

  if (previousBoardString) {
    const [project, view] = previousBoardString.value.split("|&|");
    const projectId = project.split("-")[1];

    homePageLink = `/project?id=${projectId}${
      view && view !== "undefined" ? `&view=${view}` : ""
    }`;
    originProject = projectId;
  }

  return (
    <InboxZeroProvider>
      <div className="relative min-h-screen">
        <div className="relative z-10">
          <Suspense fallback={<>Loading...</>}>
            <AgentInbox
              agent={agent}
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
