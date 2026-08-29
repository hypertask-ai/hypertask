import { ModalInput } from "@/components/Common/CommonModalComponents";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { useRecoilState } from "@/lib/state";
import { IProject } from "@/models/model";
import { currentProjectAtom } from "@/store";
import { deleteProject } from "@/utils/api/Homepage";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, useCallback, useState } from "react";
import { Trash2 } from "lucide-react";

type Props = {
    onClose: (response?: any, project?: IProject) => void;
    project?: IProject;
}

const ConfirmDeleteBoard = (props: Props) => {
    const { onClose, project } = props
    const [currentProject] = useRecoilState(currentProjectAtom)
    const [loading, setLoading] = useState(false)
    const [title, setTitle] = useState('')
    const queryClient = useQueryClient();
    const router = useRouter();
    const pathname = usePathname();
    const targetProject = project ?? currentProject
    const canDelete = title.trim() === (targetProject?.title ?? "").trim()

    const closeHandler = useCallback(() => {
        if (loading) return;
        onClose()
    }, [loading, onClose])

    const confirmHandler = useCallback(async () => {
        if (!targetProject || loading || !canDelete) return;
        setLoading(true)
        try {
            const response = await deleteProject({ projectId: targetProject.id })
            await queryClient.refetchQueries({queryKey:["getAllTeamsMinimal"]})
            await queryClient.refetchQueries({queryKey:["projectsAll"]})
            await queryClient.refetchQueries({queryKey:["getAllFavorites"]})
            const firstProject = response.data?.firstProject
            if (pathname?.startsWith('/project') && currentProject?.id === targetProject.id && firstProject?.id) {
                router.replace(`/project?id=${firstProject.id}`)
            }
            else router.refresh()
            onClose(response, targetProject)
        }
        catch (error) {
            console.error(error)
            setLoading(false)
        }
    }, [canDelete, currentProject?.id, loading, onClose, pathname, queryClient, router, targetProject])

    const onKeyChange = (e: ChangeEvent<HTMLInputElement>) => {
        setTitle(e.target.value);
    }

    if (!targetProject) return null;

    return (
        <ConfirmDialog
            id="confirmDeleteBoardModal"
            icon={Trash2}
            message={
                <>
                    Permanently delete <span className="font-medium">&quot;{targetProject.title}&quot;</span> and all its tasks. This cannot be undone.
                </>
            }
            confirmLabel="Delete board"
            loadingLabel="Deleting…"
            loading={loading}
            confirmDisabled={!canDelete}
            onConfirm={confirmHandler}
            onCancel={closeHandler}
            footerVerb="delete"
        >
            <div className="flex items-center gap-2.5 border-b border-light-black-border-1 px-4">
                <ModalInput
                    autoFocus
                    onChange={onKeyChange}
                    value={title}
                    placeholder={`Type "${targetProject.title}" to confirm`}
                    className="px-0"
                />
            </div>
        </ConfirmDialog>
    )
}

export default ConfirmDeleteBoard;
