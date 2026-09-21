import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies'
import { IProject } from '@/models/model'
import { currentProjectAtom } from '@/store'
import axios from 'axios'
import { useRouter } from 'next/navigation'
import { useRecoilState } from '@/lib/state'

const useCreateTask = () => {
    const router = useRouter()
    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    const currentUser = useCurrentUser()


    const CreateNewTaskGlobally = async(project?:IProject)=>{
        if (!currentUser?.id || !_currentProject) return
        return router.push(`
            /detail/
            ${project?.name??_currentProject.name}
            ?projectId=${project?.id??_currentProject.id}
            &project_title=${project?.title??_currentProject.title}`)
      }

    const getTask=async (taskId:number|null)=>{
        if(!taskId) return
        const fetchedTask = await axios.get("/api/tasks/single?id="+taskId);
        console.log("🚀 ~ duplicateTask ~ fetchedTask:", fetchedTask.data)
        return fetchedTask.data
    }

    return {CreateNewTaskGlobally, getTask}
}

export default useCreateTask
