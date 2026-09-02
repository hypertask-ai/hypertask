import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { useRecoilState } from "@/lib/state";
import { IProject } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { archiveProjectById } from "@/utils/api/Homepage";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Archive } from "lucide-react";

type Props = {
    onClose: (response?: any, project?: IProject) => void;
    project?: IProject;
}

const ConfirmArchiveBoard = (props: Props) => {
    const { onClose, project } = props
    const [currentProject] = useRecoilState(currentProjectAtom)
    const [loading, setLoading] = useState(false)
    const queryClient = useQueryClient();
    const router = useRouter();
    const targetProject = project ?? currentProject

    const closeHandler = useCallback(() => {
        if (loading) return;
        onClose()
    }, [loading, onClose])

    const confirmHandler = useCallback(async () => {
        if (!targetProject || loading) return;
        setLoading(true)
        try {
            const response = await archiveProjectById({ projectId: targetProject.id })
            await queryClient.refetchQueries({queryKey:["getAllTeamsMinimal"]})
            await queryClient.refetchQueries({queryKey:["projectsAll"]})
            await queryClient.refetchQueries({queryKey:["getAllFavorites"]})
            const firstProject = response.data?.firstProject
            if (currentProject?.id === targetProject.id) {
                router.replace(firstProject?.id ? `/project?id=${firstProject.id}` : "/project")
            }
            else router.refresh()
            toast.success(`Archived ${targetProject.title ?? targetProject.name ?? "board"}`)
            onClose(response, targetProject)
        }
        catch (error) {
            console.error(error)
            setLoading(false)
        }
    }, [currentProject?.id, loading, onClose, queryClient, router, targetProject])

    if (!targetProject) return null;

    return (
        <ConfirmDialog
            id="confirmArchiveBoardModal"
            icon={Archive}
            message={
                <>
                    Archive <span className="font-medium">&quot;{targetProject.title}&quot;</span>? It moves to Archived and its favorite slot is cleared.
                </>
            }
            confirmLabel="Archive board"
            loadingLabel="Archiving…"
            loading={loading}
            onConfirm={confirmHandler}
            onCancel={closeHandler}
        />
    )
}

export default ConfirmArchiveBoard;
