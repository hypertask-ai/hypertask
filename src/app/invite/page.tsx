import { IUser } from "@/models/model";
import getInvite from "@/utils/controllers/invite/getInvite";
import { cookies } from "next/headers";
import InviteComp from "./InviteComp";
import { redirect } from "next/navigation";
import { Metadata } from "next";
import membersInvite from "@/utils/controllers/members/invite";

export const metadata: Metadata = {
  title: "Invite - Hypertask",
};

export default async function InvitePage(
  props: {
    searchParams: Promise<{
      project: string;
      key: string;
      view: string;
      shouldSkipInteractive: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const { project, key, view, shouldSkipInteractive } = searchParams;
  const skipInteractive = shouldSkipInteractive === "true";

  if (!key) {
    redirect("/");
  }

  const project_from_invite = await getInvite(key);
  if (!project_from_invite?.json) {
    redirect("/");
  }

  const cookieStore = await cookies();
  const userObjString = cookieStore.get("nookies_user");

  // If user is authenticated, redeem invite on server and redirect
  if (userObjString) {
    try {
      const userObj: IUser = JSON.parse(userObjString.value);
      const projectId = project_from_invite.json.projectId;

      // Redeem invite directly on server
      const result = await membersInvite(userObj.id, projectId, key);

      // If successful, redirect to project
      // Note: redirect() throws a special NEXT_REDIRECT error that Next.js handles
      // This will exit the function and perform the redirect
      if (result.status === 200) {
        const redirectUrl = `/project?id=${projectId}${
          view && view !== "undefined" ? `&view=${view}` : ""
        }`;
        redirect(redirectUrl);
      }

      // If invite expired or invalid, still show the component
      // (it will handle the error state)
    } catch (error: any) {
      // Next.js redirect() throws a special error that should not be caught
      // Check if this is a redirect error and re-throw it so Next.js can handle it
      if (error?.digest?.startsWith('NEXT_REDIRECT')) {
        throw error;
      }
      // Only log actual errors, not redirects
      console.error("Error redeeming invite:", error);
      // Fall through to show invite component
    }
  }

  // User not authenticated - show login component
  return (
    <InviteComp
      inviteKey={key}
      projectInvited={JSON.stringify(project_from_invite.json)}
      project={project}
    />
  );
}
