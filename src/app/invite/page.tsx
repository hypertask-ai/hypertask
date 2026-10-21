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

  if (userObjString) {
    try {
      const userObj: IUser = JSON.parse(userObjString.value);
      const projectId = project_from_invite.json.projectId;

      const result = await membersInvite(userObj.id, projectId, key);

      if (result.status === 200) {
        const redirectUrl = `/project?id=${projectId}${
          view && view !== "undefined" ? `&view=${encodeURIComponent(view)}` : ""
        }`;
        redirect(redirectUrl);
      }
    } catch (error: any) {
      if (error?.digest?.startsWith('NEXT_REDIRECT')) {
        throw error;
      }
      console.error("Error redeeming invite:", error);
    }
  }

  return (
    <InviteComp
      inviteKey={key}
      projectInvited={JSON.stringify(project_from_invite.json)}
      project={project}
    />
  );
}
