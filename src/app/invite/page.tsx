import getInvite from "@/utils/controllers/invite/getInvite";
import { cookies } from "next/headers";
import InviteComp from "./InviteComp";
import { redirect } from "next/navigation";
import { Metadata } from "next";
import membersInvite from "@/utils/controllers/members/invite";
import { isGuestUser } from "@/lib/demo/guest";

export const metadata: Metadata = {
  title: "Invite - Hypertask",
};

type InviteSearch = {
  project?: string;
  key?: string;
  view?: string;
  projectId?: string;
  shouldSkipInteractive?: string;
};

type InviteVisitor =
  | { kind: "member"; id: number }
  | { kind: "guest" }
  | { kind: "signed-out" };

function loginPathForInvite(params: InviteSearch) {
  const search = new URLSearchParams();
  for (const name of ["project", "key", "projectId", "view"] as const) {
    const value = params[name];
    if (typeof value === "string" && value.length > 0) search.set(name, value);
  }
  const query = search.toString();
  return query ? `/login?${query}` : "/login";
}

async function inviteVisitor(): Promise<InviteVisitor> {
  const raw = (await cookies()).get("nookies_user")?.value;
  if (!raw) return { kind: "signed-out" };
  try {
    const user = JSON.parse(raw) as { id?: unknown; uid?: string | null };
    if (isGuestUser(user)) return { kind: "guest" };
    const id = typeof user.id === "number" ? user.id : Number(user.id);
    if (!Number.isInteger(id)) return { kind: "signed-out" };
    return { kind: "member", id };
  } catch {
    return { kind: "signed-out" };
  }
}

function projectPath(projectId: number, view: string | undefined) {
  const viewQuery =
    view && view !== "undefined" ? `&view=${encodeURIComponent(view)}` : "";
  return `/project?id=${projectId}${viewQuery}`;
}

export default async function InvitePage(props: {
  searchParams: Promise<InviteSearch>;
}) {
  const searchParams = await props.searchParams;
  const { project, key, view } = searchParams;
  const visitor = await inviteVisitor();
  const project_from_invite = key ? await getInvite(key) : null;
  const invite = project_from_invite?.json ?? null;

  if (visitor.kind === "member") {
    if (!key || !invite) redirect("/");
    try {
      const result = await membersInvite(visitor.id, invite.projectId, key);
      if (result.status === 200) {
        redirect(projectPath(invite.projectId, view));
      }
    } catch (error: any) {
      if (error?.digest?.startsWith("NEXT_REDIRECT")) {
        throw error;
      }
      console.error("Error redeeming invite:", error);
    }
  } else if (visitor.kind === "signed-out" && (!key || !invite)) {
    redirect(key ? loginPathForInvite(searchParams) : "/login");
  }

  return (
    <InviteComp
      inviteKey={key ?? ""}
      projectInvited={invite ? JSON.stringify(invite) : undefined}
      project={project}
    />
  );
}
