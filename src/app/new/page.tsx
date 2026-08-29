import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import NewTaskPage from "@/components/PageComponents/New";
import { IUser } from "@/models/model";
import getProjectById from "@/utils/controllers/projects/getById";
import getFirst from "@/utils/controllers/projects/getFirst";
import {
  findNewTaskUrlSection,
  parseNewTaskUrlTarget,
} from "@/lib/newTaskUrl";

export async function generateMetadata({ params }: any): Promise<Metadata> {
  return {
    title: "New",
  };
}

export default async function Page(props: { searchParams: Promise<any> }) {
  const searchParams = await props.searchParams;
  const target = parseNewTaskUrlTarget(searchParams);
  const cookieStore = await cookies();
  const userCookie = cookieStore.get("nookies_user");
  const prevBoard = cookieStore.get("previousBoard");
  if (!userCookie) redirect("/login");
  const userObj: IUser = JSON.parse(userCookie.value);
  let project: any = undefined;

  if (target.boardId) {
    project = await getProjectById(target.boardId, userObj.id);
  } else if (prevBoard) {
    const [projectId, view] = prevBoard.value.split("|&|");
    const projectIdNumber = projectId.split("-")[1];
    project = await getProjectById(parseInt(projectIdNumber), userObj.id);
  } else {
    const firstProjectResponse = await getFirst(userObj.id);
    project =
      firstProjectResponse?.status === 200 ? firstProjectResponse.json : null;
  }
  if (!project) redirect("/unauthorized");

  const initialSection = findNewTaskUrlSection(project.section, target);

  return <NewTaskPage currentProject={project} initialSection={initialSection} />;
}
