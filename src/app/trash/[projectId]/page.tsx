import TrashComp from "@/components/PageComponents/Trash/TrashComp";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import getTrashByProjectId from "@/utils/controllers/trash/getByProjectId";
import { parsePositiveInt } from "@/lib/parsePositiveInt";
import { notFound } from "next/navigation";

export default async function Page(props: { params: Promise<{ projectId: string }> }) {
    const params = await props.params;

    const user = await requireServerCookieUser();
    const projectId = parsePositiveInt(params.projectId)

    if (!projectId) notFound()

    const projects = await getTrashByProjectId({projectId, userId:user.id})
    if (!projects) notFound()
    return (
        <TrashComp project={projects}/>

    )
}
