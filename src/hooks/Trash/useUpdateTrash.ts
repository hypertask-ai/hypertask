import globalConstants from '@/lib/constants'
import { IProject } from '@/models/model'
import { useQueryClient } from '@tanstack/react-query'
import axios, { AxiosResponse } from 'axios';
import toast from 'react-hot-toast';

interface IRemoveFromTrash {
  projectId:number;
  taskId:number;
  mode:"recover"|"delete"
}


const useUpdateTrash = () => {
  const queryClient = useQueryClient()

  const removeFromTrash = async ({ projectId, taskId, mode }: IRemoveFromTrash) => {
    console.log("🚀 ~ removeFromTrash ~ taskId:", taskId);
    const queryKey = [globalConstants.TrashKeyPrefix, projectId];
    let allData: IProject | undefined = await queryClient.getQueryData(queryKey);
    if (!allData) return false;

    const newTasksList = allData.tasks?.filter(x => x.id !== taskId);


    let response:AxiosResponse<any, any>;
    if (mode ==="delete"){
      response = await axios.delete(globalConstants.invokeTaskDeleteRoute + `?taskId=${taskId}`)
      if (response.status===200){
        toast("The task has been permanently deleted")
        const updatedAllData = {
            ...allData,
            tasks: newTasksList,
        };
        queryClient.refetchQueries({queryKey:queryKey})
        return true;
      }
    }

    else if (mode ==="recover"){
      response = await axios.post(globalConstants.invokeTaskRecoverRoute,{taskId})
      if (response.status===200){
        toast("The task has been recovered. Please visit the board again to view it.")

        const updatedAllData = {
            ...allData,
            tasks: newTasksList,
        };
        queryClient.refetchQueries({queryKey:queryKey})
        return true;
      }
    }

};



  return {removeFromTrash}
}

export default useUpdateTrash


