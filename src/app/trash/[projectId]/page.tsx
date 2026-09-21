import TrashComp from "@/components/PageComponents/Trash/TrashComp";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import getTrashByProjectId from "@/utils/controllers/trash/getByProjectId";
import { redirect } from "next/navigation";

export default async function Page(props: { params: Promise<{ projectId: string }> }) {
    const params = await props.params;

    const user = await requireServerCookieUser();
    const projectId = parseInt(params.projectId)

    if (!user ){
        return redirect("/login")
    }

    const projects = await getTrashByProjectId({projectId, userId:user.id})
    console.log("🚀 ~ Page ~ projects:", projects)
    if (!projects ){
        return redirect("/login")
    }
    return (
        <TrashComp project={projects}/>

    )
}
